// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IReputation} from "./interfaces/IReputation.sol";

/// @title Reputation
/// @notice On-chain track record for marketplace participants. Written only by JobEscrow.
contract Reputation is AccessControl, IReputation {
    bytes32 public constant ESCROW_ROLE = keccak256("ESCROW_ROLE");

    struct Record {
        uint32 jobsCompleted;
        uint32 ratingCount;
        uint32 ratingSum;
        uint32 disputesWon;
        uint32 disputesLost;
    }

    mapping(address => Record) private _records;

    event CompletionRecorded(address indexed client, address indexed freelancer);
    event RatingRecorded(address indexed ratee, uint8 score);
    event DisputeRecorded(address indexed winner, address indexed loser);

    error InvalidScore();
    error ZeroAddress();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function recordCompletion(address client, address freelancer) external onlyRole(ESCROW_ROLE) {
        unchecked {
            _records[client].jobsCompleted++;
            _records[freelancer].jobsCompleted++;
        }
        emit CompletionRecorded(client, freelancer);
    }

    function recordRating(address ratee, uint8 score) external onlyRole(ESCROW_ROLE) {
        if (score < 1 || score > 5) revert InvalidScore();
        Record storage r = _records[ratee];
        unchecked {
            r.ratingCount++;
            r.ratingSum += score;
        }
        emit RatingRecorded(ratee, score);
    }

    function recordDispute(address winner, address loser) external onlyRole(ESCROW_ROLE) {
        unchecked {
            _records[winner].disputesWon++;
            _records[loser].disputesLost++;
        }
        emit DisputeRecorded(winner, loser);
    }

    function getRecord(address user) external view returns (Record memory) {
        return _records[user];
    }

    /// @notice Average rating scaled by 100 (e.g. 450 = 4.50). Zero when unrated.
    function averageRatingX100(address user) external view returns (uint256) {
        Record storage r = _records[user];
        if (r.ratingCount == 0) return 0;
        return (uint256(r.ratingSum) * 100) / r.ratingCount;
    }
}
