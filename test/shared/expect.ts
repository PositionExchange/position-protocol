const {expect, use} = require('chai')
import { solidity } from 'ethereum-waffle'
import { jestSnapshotPlugin } from 'mocha-chai-jest-snapshot'

use(solidity)
use(jestSnapshotPlugin())

export { expect }
