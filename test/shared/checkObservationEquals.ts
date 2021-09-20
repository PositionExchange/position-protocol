import {BigNumber, BigNumberish} from 'ethers'
import {expect} from './expect'

// helper function because we cannot do a simple deep equals with the
// observation result object returned from ethers because it extends array
export default function checkObservationEquals(
    {
        pipCumulative,
        blockTimestamp,
        initialized,
    }: {
        pipCumulative: BigNumber
        initialized: boolean
        blockTimestamp: number
    },
    expected: {
        pipCumulative: BigNumberish
        initialized: boolean
        blockTimestamp: number
    }
) {
    expect(
        {
            initialized,
            blockTimestamp,
            pipCumulative: pipCumulative.toString(),
        },
        `observation is equivalent`
    ).to.deep.eq({
        ...expected,
        pipCumulative: expected.pipCumulative.toString(),
    })
}
