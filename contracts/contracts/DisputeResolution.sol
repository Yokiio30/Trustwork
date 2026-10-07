// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import {IJobEscrow} from "./interfaces/IJobEscrow.sol";

/// @title DisputeResolution
/// @notice Arbiter voting on disputed milestones. Executes the verdict on JobEscrow.
contract DisputeResolution is AccessControlEnumerable {
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");

    uint16 public constant VOTES_REQUIRED = 2;
    uint64 public constant MIN_VOTING_PERIOD = 1 minutes;

    enum DisputeStatus {
        Open,
        Resolved
    }

    // Gas: the whole dispute fits in one storage slot (31 bytes). Who raised it and the reason hash are
    // only emitted in DisputeRaised. jobId is uint64: the escrow validated it against its own counter.
    struct Dispute {
        uint64 jobId;
        uint64 createdAt;
        uint64 votingDeadline;
        uint8 milestoneIdx;
        DisputeStatus status;
        bool freelancerWon;
        uint16 votesFreelancer;
        uint16 votesClient;
    }

    IJobEscrow public immutable escrow;
    uint64 public votingPeriod;
    uint256 public disputeCount;

    mapping(uint256 => Dispute) private _disputes;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event DisputeRaised(uint256 indexed disputeId, uint256 indexed jobId, uint8 milestoneIdx, address indexed raisedBy, bytes32 reasonHash, uint64 votingDeadline);
    event EvidenceSubmitted(uint256 indexed disputeId, address indexed submitter, bytes32 evidenceHash, string note);
    event VoteCast(uint256 indexed disputeId, address indexed arbiter, bool favorFreelancer);
    event DisputeResolved(uint256 indexed disputeId, uint256 indexed jobId, bool freelancerWon);
    event VotingPeriodUpdated(uint64 period);

    error ZeroAddress();
    error UnknownDispute();
    error NotParty();
    error ConflictOfInterest();
    error InvalidStatus();
    error AlreadyVoted();
    error VotingClosed();
    error VotingStillOpen();
    error VotingPeriodTooShort();

    constructor(address admin, address escrow_, uint64 votingPeriod_) {
        if (admin == address(0) || escrow_ == address(0)) revert ZeroAddress();
        if (votingPeriod_ < MIN_VOTING_PERIOD) revert VotingPeriodTooShort();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        escrow = IJobEscrow(escrow_);
        votingPeriod = votingPeriod_;
    }

    /// @notice A job party disputes the currently submitted milestone.
    function raiseDispute(uint256 jobId, uint8 milestoneIdx, bytes32 reasonHash) external returns (uint256 disputeId) {
        (address client, address freelancer,) = escrow.getJobParties(jobId);
        if (msg.sender != client && msg.sender != freelancer) revert NotParty();

        disputeId = ++disputeCount;
        Dispute storage d = _disputes[disputeId];
        d.jobId = uint64(jobId);
        d.createdAt = uint64(block.timestamp);
        d.votingDeadline = uint64(block.timestamp) + votingPeriod;
        d.milestoneIdx = milestoneIdx;

        emit DisputeRaised(disputeId, jobId, milestoneIdx, msg.sender, reasonHash, d.votingDeadline);

        // Interaction last. Reverts (undoing everything above) unless the milestone is Submitted
        // and still inside the review window.
        escrow.markDisputed(jobId, milestoneIdx);
    }

    /// @notice Either party attaches evidence. Only the hash and a short note are published.
    function submitEvidence(uint256 disputeId, bytes32 evidenceHash, string calldata note) external {
        Dispute storage d = _dispute(disputeId);
        if (d.status != DisputeStatus.Open) revert InvalidStatus();
        (address client, address freelancer,) = escrow.getJobParties(d.jobId);
        if (msg.sender != client && msg.sender != freelancer) revert NotParty();
        emit EvidenceSubmitted(disputeId, msg.sender, evidenceHash, note);
    }

    /// @notice Arbiter votes. Arbiters cannot be a party to the job they judge.
    function castVote(uint256 disputeId, bool favorFreelancer) external onlyRole(ARBITER_ROLE) {
        Dispute storage d = _dispute(disputeId);
        if (d.status != DisputeStatus.Open) revert InvalidStatus();
        if (block.timestamp > d.votingDeadline) revert VotingClosed();
        if (hasVoted[disputeId][msg.sender]) revert AlreadyVoted();

        (address client, address freelancer,) = escrow.getJobParties(d.jobId);
        if (msg.sender == client || msg.sender == freelancer) revert ConflictOfInterest();

        hasVoted[disputeId][msg.sender] = true;
        if (favorFreelancer) d.votesFreelancer++;
        else d.votesClient++;
        emit VoteCast(disputeId, msg.sender, favorFreelancer);
    }

    /// @notice Anyone can execute once a side has VOTES_REQUIRED votes, or after the voting deadline.
    /// @dev After the deadline the plurality wins; a tie (including no votes) favors the client,
    ///      because the freelancer carries the burden of showing the work was delivered.
    function executeResolution(uint256 disputeId) external {
        Dispute storage d = _dispute(disputeId);
        if (d.status != DisputeStatus.Open) revert InvalidStatus();

        bool freelancerWon;
        if (d.votesFreelancer >= VOTES_REQUIRED) {
            freelancerWon = true;
        } else if (d.votesClient >= VOTES_REQUIRED) {
            freelancerWon = false;
        } else {
            if (block.timestamp <= d.votingDeadline) revert VotingStillOpen();
            freelancerWon = d.votesFreelancer > d.votesClient;
        }

        d.status = DisputeStatus.Resolved;
        d.freelancerWon = freelancerWon;
        emit DisputeResolved(disputeId, d.jobId, freelancerWon);

        escrow.applyResolution(d.jobId, d.milestoneIdx, freelancerWon);
    }

    function setVotingPeriod(uint64 period) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (period < MIN_VOTING_PERIOD) revert VotingPeriodTooShort();
        votingPeriod = period;
        emit VotingPeriodUpdated(period);
    }

    function getDispute(uint256 disputeId) external view returns (Dispute memory) {
        return _dispute(disputeId);
    }

    function arbiterCount() external view returns (uint256) {
        return getRoleMemberCount(ARBITER_ROLE);
    }

    function _dispute(uint256 disputeId) private view returns (Dispute storage d) {
        d = _disputes[disputeId];
        if (d.createdAt == 0) revert UnknownDispute();
    }
}
