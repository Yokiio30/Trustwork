// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IJobEscrow {
    enum JobStatus {
        Open,
        Funded,
        InProgress,
        Disputed,
        Completed,
        Cancelled,
        Terminated
    }

    enum MilestoneStatus {
        Pending,
        Submitted,
        Approved,
        Disputed,
        Refunded
    }

    function getJobParties(uint256 jobId) external view returns (address client, address freelancer, JobStatus status);

    function markDisputed(uint256 jobId, uint8 milestoneIdx) external;

    function applyResolution(uint256 jobId, uint8 milestoneIdx, bool favorFreelancer) external;
}
