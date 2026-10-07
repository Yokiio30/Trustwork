// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IJobEscrow} from "./interfaces/IJobEscrow.sol";
import {IReputation} from "./interfaces/IReputation.sol";

/// @title JobEscrow
/// @notice Holds client funds for freelance jobs and releases them milestone by milestone.
/// @dev Payouts use the pull-payment pattern (balances + withdraw) so no external call
///      happens while job state is being updated.
contract JobEscrow is IJobEscrow, AccessControl, ReentrancyGuard {
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");

    uint8 public constant MAX_MILESTONES = 5;
    uint16 public constant MAX_FEE_BPS = 500; // 5%
    uint64 public constant MIN_REVIEW_PERIOD = 1 minutes;

    // Gas: three storage slots per job. Amounts are uint96 (max ~7.9e28 wei, far above total ETH supply)
    // so each amount shares a slot with an address. The description hash and deliverable hashes are not
    // stored; they are emitted in events (JobCreated, MilestoneSubmitted), which is enough for the
    // backend and for anyone verifying a document against its on-chain hash.
    struct Job {
        address client; // slot 0
        uint96 remaining; // funds still held in escrow for this job
        address freelancer; // slot 1
        uint96 totalAmount;
        JobStatus status; // slot 2
        uint16 feeBps; // snapshot taken at creation
        uint8 milestoneCount;
        uint8 nextMilestone;
        bool flagged;
        bool clientRated;
        bool freelancerRated;
    }

    // One slot: 12 + 1 + 8 bytes.
    struct Milestone {
        uint96 amount;
        MilestoneStatus status;
        uint64 submittedAt;
    }

    IReputation public immutable reputation;
    address public disputeResolution;

    uint256 public jobCount;
    uint16 public platformFeeBps;
    uint64 public reviewPeriod;
    uint256 public accruedFees;

    mapping(uint256 => Job) private _jobs;
    mapping(uint256 => Milestone[]) private _milestones;
    mapping(address => uint256) public balances;

    event JobCreated(uint256 indexed jobId, address indexed client, uint256 totalAmount, uint8 milestoneCount, bytes32 descriptionHash);
    event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount);
    event JobAccepted(uint256 indexed jobId, address indexed freelancer);
    event JobCancelled(uint256 indexed jobId, uint256 refunded);
    event MilestoneSubmitted(uint256 indexed jobId, uint8 indexed milestoneIdx, bytes32 deliverableHash);
    event MilestoneApproved(uint256 indexed jobId, uint8 indexed milestoneIdx, uint256 payout, uint256 fee, bool viaTimeout);
    event JobCompleted(uint256 indexed jobId);
    event JobDisputed(uint256 indexed jobId, uint8 indexed milestoneIdx);
    event DisputeApplied(uint256 indexed jobId, uint8 indexed milestoneIdx, bool favorFreelancer);
    event JobTerminated(uint256 indexed jobId, uint256 refunded);
    event JobRated(uint256 indexed jobId, address indexed rater, address indexed ratee, uint8 score);
    event JobFlagged(uint256 indexed jobId, address indexed auditor, bytes32 reasonHash);
    event Withdrawn(address indexed account, uint256 amount);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event PlatformFeeUpdated(uint16 feeBps);
    event ReviewPeriodUpdated(uint64 period);
    event DisputeResolutionUpdated(address indexed disputeResolution);

    error ZeroAddress();
    error UnknownJob();
    error NotClient();
    error NotFreelancer();
    error NotParty();
    error SelfDealing();
    error InvalidStatus();
    error InvalidAmount();
    error InvalidMilestone();
    error ReviewPeriodNotElapsed();
    error ReviewPeriodElapsed();
    error NothingToWithdraw();
    error TransferFailed();
    error FeeTooHigh();
    error ReviewPeriodTooShort();
    error NotDisputeResolution();
    error AlreadyRated();
    error InvalidScore();

    modifier onlyDisputeResolution() {
        if (msg.sender != disputeResolution) revert NotDisputeResolution();
        _;
    }

    constructor(address admin, address reputation_, uint16 feeBps, uint64 reviewPeriod_) {
        if (admin == address(0) || reputation_ == address(0)) revert ZeroAddress();
        if (feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        if (reviewPeriod_ < MIN_REVIEW_PERIOD) revert ReviewPeriodTooShort();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        reputation = IReputation(reputation_);
        platformFeeBps = feeBps;
        reviewPeriod = reviewPeriod_;
    }

    // ------------------------------------------------------------------
    // Client / freelancer flow
    // ------------------------------------------------------------------

    /// @notice Create a job split into 1..MAX_MILESTONES milestones. Funds are deposited separately.
    function createJob(bytes32 descriptionHash, uint96[] calldata amounts) external returns (uint256 jobId) {
        uint256 n = amounts.length;
        if (n == 0 || n > MAX_MILESTONES) revert InvalidMilestone();

        jobId = ++jobCount;
        uint256 total;
        for (uint256 i; i < n; ++i) {
            uint96 a = amounts[i];
            if (a == 0) revert InvalidAmount();
            total += a;
            _milestones[jobId].push(Milestone({amount: a, status: MilestoneStatus.Pending, submittedAt: 0}));
        }
        if (total > type(uint96).max) revert InvalidAmount();

        Job storage job = _jobs[jobId];
        job.client = msg.sender;
        job.status = JobStatus.Open;
        job.feeBps = platformFeeBps;
        job.milestoneCount = uint8(n);
        job.totalAmount = uint96(total);

        emit JobCreated(jobId, msg.sender, total, uint8(n), descriptionHash);
    }

    /// @notice Client locks the full job amount in escrow.
    function fundJob(uint256 jobId) external payable {
        Job storage job = _job(jobId);
        if (msg.sender != job.client) revert NotClient();
        if (job.status != JobStatus.Open) revert InvalidStatus();
        if (msg.value != job.totalAmount) revert InvalidAmount();

        job.remaining = job.totalAmount;
        job.status = JobStatus.Funded;
        emit JobFunded(jobId, msg.sender, msg.value);
    }

    /// @notice Client cancels before any freelancer has accepted. Escrowed funds are credited back.
    function cancelJob(uint256 jobId) external {
        Job storage job = _job(jobId);
        if (msg.sender != job.client) revert NotClient();
        if (job.status != JobStatus.Open && job.status != JobStatus.Funded) revert InvalidStatus();

        uint96 refund = job.remaining;
        job.remaining = 0;
        job.status = JobStatus.Cancelled;
        if (refund > 0) balances[job.client] += refund;
        emit JobCancelled(jobId, refund);
    }

    /// @notice A freelancer takes a funded job.
    function acceptJob(uint256 jobId) external {
        Job storage job = _job(jobId);
        if (job.status != JobStatus.Funded) revert InvalidStatus();
        if (msg.sender == job.client) revert SelfDealing();

        job.freelancer = msg.sender;
        job.status = JobStatus.InProgress;
        emit JobAccepted(jobId, msg.sender);
    }

    /// @notice Freelancer submits the next milestone for review.
    function submitMilestone(uint256 jobId, uint8 milestoneIdx, bytes32 deliverableHash) external {
        Job storage job = _job(jobId);
        if (msg.sender != job.freelancer) revert NotFreelancer();
        if (job.status != JobStatus.InProgress) revert InvalidStatus();
        if (milestoneIdx != job.nextMilestone) revert InvalidMilestone();

        Milestone storage m = _milestones[jobId][milestoneIdx];
        if (m.status != MilestoneStatus.Pending) revert InvalidStatus();

        m.status = MilestoneStatus.Submitted;
        m.submittedAt = uint64(block.timestamp);
        emit MilestoneSubmitted(jobId, milestoneIdx, deliverableHash);
    }

    /// @notice Client accepts a submitted milestone and releases payment to the freelancer.
    function approveMilestone(uint256 jobId, uint8 milestoneIdx) external {
        Job storage job = _job(jobId);
        if (msg.sender != job.client) revert NotClient();
        _requireSubmitted(job, jobId, milestoneIdx);
        _release(jobId, job, milestoneIdx, false);
    }

    /// @notice Freelancer claims payment when the client stayed silent past the review period.
    function claimTimeout(uint256 jobId, uint8 milestoneIdx) external {
        Job storage job = _job(jobId);
        if (msg.sender != job.freelancer) revert NotFreelancer();
        Milestone storage m = _requireSubmitted(job, jobId, milestoneIdx);
        if (block.timestamp < uint256(m.submittedAt) + reviewPeriod) revert ReviewPeriodNotElapsed();
        _release(jobId, job, milestoneIdx, true);
    }

    /// @notice Rate the counterparty once a job has finished (completed or terminated by dispute).
    function rateCounterparty(uint256 jobId, uint8 score) external {
        Job storage job = _job(jobId);
        if (job.status != JobStatus.Completed && job.status != JobStatus.Terminated) revert InvalidStatus();
        if (score < 1 || score > 5) revert InvalidScore();

        address ratee;
        if (msg.sender == job.client) {
            if (job.clientRated) revert AlreadyRated();
            job.clientRated = true;
            ratee = job.freelancer;
        } else if (msg.sender == job.freelancer) {
            if (job.freelancerRated) revert AlreadyRated();
            job.freelancerRated = true;
            ratee = job.client;
        } else {
            revert NotParty();
        }

        emit JobRated(jobId, msg.sender, ratee, score);
        reputation.recordRating(ratee, score);
    }

    /// @notice Withdraw any funds credited to the caller (payouts and refunds).
    function withdraw() external nonReentrant {
        uint256 amount = balances[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        balances[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    // ------------------------------------------------------------------
    // Dispute hooks (DisputeResolution only)
    // ------------------------------------------------------------------

    function markDisputed(uint256 jobId, uint8 milestoneIdx) external onlyDisputeResolution {
        Job storage job = _job(jobId);
        Milestone storage m = _requireSubmitted(job, jobId, milestoneIdx);
        // After the review window only the freelancer's timeout claim is valid.
        if (block.timestamp >= uint256(m.submittedAt) + reviewPeriod) revert ReviewPeriodElapsed();

        m.status = MilestoneStatus.Disputed;
        job.status = JobStatus.Disputed;
        emit JobDisputed(jobId, milestoneIdx);
    }

    function applyResolution(uint256 jobId, uint8 milestoneIdx, bool favorFreelancer) external onlyDisputeResolution {
        Job storage job = _job(jobId);
        if (job.status != JobStatus.Disputed) revert InvalidStatus();
        Milestone storage m = _milestones[jobId][milestoneIdx];
        if (m.status != MilestoneStatus.Disputed) revert InvalidStatus();

        emit DisputeApplied(jobId, milestoneIdx, favorFreelancer);

        if (favorFreelancer) {
            job.status = JobStatus.InProgress;
            _release(jobId, job, milestoneIdx, false);
            reputation.recordDispute(job.freelancer, job.client);
        } else {
            m.status = MilestoneStatus.Refunded;
            uint96 refund = job.remaining;
            job.remaining = 0;
            job.status = JobStatus.Terminated;
            balances[job.client] += refund;
            emit JobTerminated(jobId, refund);
            reputation.recordDispute(job.client, job.freelancer);
        }
    }

    // ------------------------------------------------------------------
    // Auditor / admin
    // ------------------------------------------------------------------

    /// @notice Auditor marks a job as suspicious. Informational only; it does not move funds.
    function flagJob(uint256 jobId, bytes32 reasonHash) external onlyRole(AUDITOR_ROLE) {
        Job storage job = _job(jobId);
        job.flagged = true;
        emit JobFlagged(jobId, msg.sender, reasonHash);
    }

    function setPlatformFee(uint16 feeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        platformFeeBps = feeBps;
        emit PlatformFeeUpdated(feeBps);
    }

    function setReviewPeriod(uint64 period) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (period < MIN_REVIEW_PERIOD) revert ReviewPeriodTooShort();
        reviewPeriod = period;
        emit ReviewPeriodUpdated(period);
    }

    function setDisputeResolution(address addr) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (addr == address(0)) revert ZeroAddress();
        disputeResolution = addr;
        emit DisputeResolutionUpdated(addr);
    }

    function withdrawFees(address to) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = accruedFees;
        if (amount == 0) revert NothingToWithdraw();
        accruedFees = 0;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit FeesWithdrawn(to, amount);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _job(jobId);
    }

    function getMilestones(uint256 jobId) external view returns (Milestone[] memory) {
        _job(jobId);
        return _milestones[jobId];
    }

    function getMilestoneInfo(uint256 jobId, uint8 milestoneIdx) external view returns (MilestoneStatus status, uint64 submittedAt) {
        _job(jobId);
        Milestone storage m = _milestones[jobId][milestoneIdx];
        return (m.status, m.submittedAt);
    }

    function getJobParties(uint256 jobId) external view returns (address client, address freelancer, JobStatus status) {
        Job storage job = _job(jobId);
        return (job.client, job.freelancer, job.status);
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    function _job(uint256 jobId) private view returns (Job storage job) {
        job = _jobs[jobId];
        if (job.client == address(0)) revert UnknownJob();
    }

    function _requireSubmitted(Job storage job, uint256 jobId, uint8 milestoneIdx) private view returns (Milestone storage m) {
        if (job.status != JobStatus.InProgress && job.status != JobStatus.Disputed) revert InvalidStatus();
        if (milestoneIdx >= job.milestoneCount || milestoneIdx != job.nextMilestone) revert InvalidMilestone();
        m = _milestones[jobId][milestoneIdx];
        if (m.status != MilestoneStatus.Submitted) revert InvalidStatus();
        // A disputed job has no Submitted milestone, so this also blocks approve/claim during a dispute.
    }

    function _release(uint256 jobId, Job storage job, uint8 milestoneIdx, bool viaTimeout) private {
        Milestone storage m = _milestones[jobId][milestoneIdx];
        m.status = MilestoneStatus.Approved;

        uint256 amount = m.amount;
        uint256 fee = (amount * job.feeBps) / 10_000;
        uint256 payout = amount - fee;

        job.remaining -= uint96(amount);
        job.nextMilestone = milestoneIdx + 1;
        balances[job.freelancer] += payout;
        accruedFees += fee;
        emit MilestoneApproved(jobId, milestoneIdx, payout, fee, viaTimeout);

        if (job.nextMilestone == job.milestoneCount) {
            job.status = JobStatus.Completed;
            emit JobCompleted(jobId);
            reputation.recordCompletion(job.client, job.freelancer);
        }
    }
}
