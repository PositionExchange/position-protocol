// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract PositionNotionalConfigProxyTest is Initializable {
    bytes32 constant BTC_BUSD = "BTC_BUSD";
    bytes32 constant BNB_BUSD = "BNB_BUSD";
    bytes32 constant POSI_BUSD = "POSI_BUSD";
    bytes32 constant TEST = "TEST";

    function getMaxNotional(bytes32 key, uint16 leverage) external returns (uint256){
        if(key == BTC_BUSD) { //BTC_BUSD hash
            if(leverage == 1) {
                return 1_000_000_000_000;
            }else if(leverage == 2){
                return 6_000_000;
            }else if(leverage == 3){
                return 4_000_000;
            }else if(leverage == 4){
                return 2_000_000;
            }else if(leverage >= 5 && leverage <= 10){
                return 60_000;
            }else if(leverage > 10 && leverage <= 20){
                return 40_000;
            }else if(leverage > 20 && leverage <= 50){
                return 30_000;
            }else if(leverage > 50 && leverage <= 100){
                return 1_000_000;
            }else if(leverage > 100 && leverage <= 124){
                return 250_000;
            }
            return 50_000;
        } else if (key == BNB_BUSD) { //BNB_BUSD hash
            if(leverage == 1) {
                return 10000;
            }else if(leverage == 2){
                return 3000;
            }else if(leverage == 3){
                return 2000;
            }else if(leverage == 4){
                return 1500;
            }else if(leverage >= 5 && leverage <= 10){
                return 900;
            }else if(leverage > 10 && leverage <= 20){
                return 100_000;
            }else if(leverage > 20 && leverage <= 50){
                return 50_000;
            }else if(leverage > 50 && leverage <= 100){
                return 10_000;
            }
        } else if (key == POSI_BUSD) {
            if(leverage == 1) {
                return 64766;
            }else if(leverage == 2){
                return 32383;
            }else if(leverage == 3){
                return 19430;
            }else if(leverage == 4){
                return 9715;
            }else if(leverage >= 5 && leverage <= 10){
                return 6476;
            }else if(leverage > 10 && leverage <= 15){
                return 3886;
            }else if(leverage > 15 && leverage <= 20){
                return 1943;
            }
        } else if (key == TEST) {
            return 1_000_000_000_000;
        }
        return 50_000;
    }
}