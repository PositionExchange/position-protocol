// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import {Errors} from "../libraries/helpers/Errors.sol";

abstract contract WhitelistManager {
    // Whitelist for position manager address
    mapping(address => bool) internal whitelistManager;

    event WhitelistPositionManagerAdded(address pmAddress);
    event WhitelistPositionManagerRemoved(address pmAddress);

    function isWhitelistManager(address _positionManager)
        public
        view
        returns (bool)
    {
        return whitelistManager[_positionManager];
    }

    function _setWhitelistManager(address _positionManager) internal {
        whitelistManager[_positionManager] = true;
        emit WhitelistPositionManagerAdded(_positionManager);
    }

    function _removeWhitelistManager(address _positionManager) internal {
        whitelistManager[_positionManager] = false;
        emit WhitelistPositionManagerRemoved(_positionManager);
    }

    modifier onlyWhitelistManager(address _positionManager) {
        require(
            isWhitelistManager(_positionManager),
            Errors.VL_NOT_WHITELIST_MANAGER
        );
        _;
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[49] private __gap;
}
