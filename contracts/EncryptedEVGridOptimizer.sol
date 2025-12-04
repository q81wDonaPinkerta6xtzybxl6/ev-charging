// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, euint64, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

// Developer note: prioritize compact storage layout for gas savings.
// Style: keep functions short and focused; avoid excessive state writes.

contract EncryptedEVGridOptimizer is SepoliaConfig {
    // Dev hint: use sequential incremental ids for simpler indexing.
    uint256 public sessionCount;

    // Encrypted charging session record
    struct EncryptedSession {
        uint256 id;
        euint32 encryptedStationId;   // encrypted station identifier
        euint32 encryptedStartTs;     // encrypted start timestamp bucket
        euint32 encryptedDuration;    // encrypted session duration bucket
        euint32 encryptedEnergyKWh;   // encrypted energy consumed
        uint256 submittedAt;
    }

    // Aggregated encrypted metric containers
    struct AggregatedEncryptedMetrics {
        euint64 encryptedTotalEnergy;    // encrypted total energy for window
        euint32 encryptedSessionCount;   // encrypted count
        bool initialized;
    }

    // Decrypted outputs placeholder
    struct DecryptedOutput {
        string label;
        string payload;
        bool revealed;
    }

    // Storage
    mapping(uint256 => EncryptedSession) public sessions;
    mapping(bytes32 => AggregatedEncryptedMetrics) private metricsByWindow;
    mapping(uint256 => DecryptedOutput) public decryptedOutputs;

    // Cross-reference where FHE request id -> internal key
    mapping(uint256 => bytes32) private requestKey;

    // Events
    event SessionSubmitted(uint256 indexed id, uint256 when);
    event ForecastRequested(bytes32 indexed windowKey, uint256 requestId);
    event ForecastDelivered(uint256 indexed requestId, bytes32 windowKey);
    event LoadBalanceRequested(uint256 indexed requestId);
    event LoadBalanceApplied(uint256 indexed requestId);
    event SiteSuggestionRequested(uint256 indexed requestId);
    event SiteSuggestionDelivered(uint256 indexed requestId);

    // Minor comment: modifiers keep access checks centralized.
    modifier onlyOwner() {
        // Placeholder for ownership check in extended deployments.
        _;
    }

    /// @notice Submit encrypted charging session data
    function submitEncryptedSession(
        euint32 encryptedStationId,
        euint32 encryptedStartTs,
        euint32 encryptedDuration,
        euint32 encryptedEnergyKWh
    ) public {
        sessionCount += 1;
        uint256 newId = sessionCount;

        sessions[newId] = EncryptedSession({
            id: newId,
            encryptedStationId: encryptedStationId,
            encryptedStartTs: encryptedStartTs,
            encryptedDuration: encryptedDuration,
            encryptedEnergyKWh: encryptedEnergyKWh,
            submittedAt: block.timestamp
        });

        // Emit a succinct on-chain signal for off-chain indexing.
        emit SessionSubmitted(newId, block.timestamp);
    }

    // Note: windowKey is an opaque identifier for aggregation windows.
    function addToWindowAggregates(
        bytes32 windowKey,
        euint64 encEnergy,
        euint32 encCount
    ) public {
        AggregatedEncryptedMetrics storage m = metricsByWindow[windowKey];
        if (!m.initialized) {
            m.encryptedTotalEnergy = encEnergy;
            m.encryptedSessionCount = encCount;
            m.initialized = true;
        } else {
            m.encryptedTotalEnergy = FHE.add64(m.encryptedTotalEnergy, encEnergy);
            m.encryptedSessionCount = FHE.add(m.encryptedSessionCount, encCount);
        }
    }

    // Dev remark: these request functions are thin wrappers over FHE.requestDecryption
    function requestDemandForecast(bytes32 windowKey) public {
        AggregatedEncryptedMetrics storage m = metricsByWindow[windowKey];
        require(m.initialized, "No metrics for window");

        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(m.encryptedTotalEnergy);
        ciphertexts[1] = FHE.toBytes32(m.encryptedSessionCount);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.receiveForecast.selector);
        requestKey[reqId] = windowKey;

        emit ForecastRequested(windowKey, reqId);
    }

    /// @notice Callback invoked by FHE after forecast decryption
    function receiveForecast(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        bytes32 windowKey = requestKey[requestId];
        require(windowKey != bytes32(0), "Unknown request");

        // Verify cryptographic proof of correct decryption
        FHE.checkSignatures(requestId, cleartexts, proof);

        // Decoding into expected types: string label and payload
        string[] memory results = abi.decode(cleartexts, (string[]));
        // Create a human-friendly container for later retrieval
        decryptedOutputs[requestId] = DecryptedOutput({
            label: results[0],
            payload: results[1],
            revealed: true
        });

        emit ForecastDelivered(requestId, windowKey);
    }

    // Scheduling support: request load balancing decisions based on encrypted inputs
    function requestLoadBalancingDecision(bytes32 windowKey, euint32 encryptedPriority) public {
        AggregatedEncryptedMetrics storage m = metricsByWindow[windowKey];
        require(m.initialized, "No metrics for window");

        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(m.encryptedTotalEnergy);
        ciphertexts[1] = FHE.toBytes32(m.encryptedSessionCount);
        ciphertexts[2] = FHE.toBytes32(encryptedPriority);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.applyLoadBalance.selector);
        requestKey[reqId] = windowKey;

        emit LoadBalanceRequested(reqId);
    }

    function applyLoadBalance(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        bytes32 windowKey = requestKey[requestId];
        require(windowKey != bytes32(0), "Unknown request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        string[] memory results = abi.decode(cleartexts, (string[]));
        decryptedOutputs[requestId] = DecryptedOutput({
            label: results[0],
            payload: results[1],
            revealed: true
        });

        // Emit for off-chain actors to enact balancing actions
        emit LoadBalanceApplied(requestId);
    }

    // Request recommendations for candidate charger site locations
    function requestSiteSuggestion(
        bytes32 regionKey,
        euint64 encryptedDemandMetric,
        euint32 encryptedStationCount
    ) public onlyOwner {
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(encryptedDemandMetric);
        ciphertexts[1] = FHE.toBytes32(encryptedStationCount);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.receiveSiteSuggestion.selector);
        requestKey[reqId] = regionKey;

        emit SiteSuggestionRequested(reqId);
    }

    function receiveSiteSuggestion(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        bytes32 regionKey = requestKey[requestId];
        require(regionKey != bytes32(0), "Unknown request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        string[] memory results = abi.decode(cleartexts, (string[]));
        decryptedOutputs[requestId] = DecryptedOutput({
            label: results[0],
            payload: results[1],
            revealed: true
        });

        emit SiteSuggestionDelivered(requestId);
    }

    // Public accessor for decrypted payloads by request id
    function getDecryptedOutput(uint256 requestId) public view returns (string memory label, string memory payload, bool revealed) {
        DecryptedOutput storage o = decryptedOutputs[requestId];
        return (o.label, o.payload, o.revealed);
    }

    // Helper: compute a window key from a unix bucket
    function computeWindowKey(uint256 bucketStart) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(bucketStart));
    }

    // Minimal utility to convert bytes32 to uint256
    function bytes32ToUint(bytes32 b) internal pure returns (uint256) {
        return uint256(b);
    }

    // Dev note: leaving a simple health-check function for monitoring.
    function ping() public pure returns (string memory) {
        return "ok";
    }
}
