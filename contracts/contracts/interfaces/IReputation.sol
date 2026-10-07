// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IReputation {
    function recordCompletion(address client, address freelancer) external;

    function recordRating(address ratee, uint8 score) external;

    function recordDispute(address winner, address loser) external;
}
