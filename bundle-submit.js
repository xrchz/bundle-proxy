require('dotenv').config()
const { program } = require('commander')
program.option('-f, --futureBlocks <n>', 'number of blocks after current to start', '1')
       .option('-m, --maxTries <m>', 'number of blocks to attempt to submit the bundle', '10')
       .option('-c, --network <name>', 'network (chain)', 'mainnet')
       .option('-t, --txFile <file>', 'file containing lines of signed transactions', 'txs.txt')
       .option('-n, --dryRun', 'simulate bundle only')
program.parse()
const options = program.opts()

const futureBlocks = parseInt(options.futureBlocks)
const maxTries = parseInt(options.maxTries)

const bundle = require('fs')
  .readFileSync(options.txFile, 'utf-8')
  .split('\n')
  .filter(line => line.length && !line.startsWith('#'))
  .map(tx => ({signedTransaction: tx}))
const ethers = require('ethers')

function ppTx(tx) {
  return [
    `hash:${tx.hash}`,
    `to:${tx.to}`,
    `from:${tx.from}`,
    `nonce:${tx.nonce}`,
    `gasLimit:${tx.gasLimit.toString()}`,
    `maxFeePerGas:${ethers.utils.formatUnits(tx.maxFeePerGas, "gwei")}`,
    `maxPriorityFeePerGas:${ethers.utils.formatUnits(tx.maxPriorityFeePerGas, "gwei")}`,
    `data:${tx.data}`,
    `value:${ethers.utils.formatUnits(tx.value, "ether")}`,
    `chainId:${tx.chainId}`].join('\n')
}

console.log('Bundle:\n')
bundle.forEach(x => {
  console.log(ppTx(ethers.utils.parseTransaction(x.signedTransaction)))
  console.log('')
})

const minMaxFeeInBundle = bundle
  .map(x => ethers.utils.parseTransaction(x.signedTransaction).maxFeePerGas)
  .reduce((min, v) => v.lt(min) ? v : min)

const flashbots = require('@flashbots/ethers-provider-bundle')

const provider = ethers.getDefaultProvider(options.network, {
  'etherscan': process.env.ETHERSCAN_KEY,
  'pocket': process.env.POCKET_KEY,
});

const authSigner = new ethers.Wallet(process.env.AUTH_SIGNER_KEY)

;(async () => {
const flashbotsProvider = await flashbots.FlashbotsBundleProvider.create(
  provider,
  authSigner,
  options.network === 'goerli' ? 'https://relay-goerli.flashbots.net/' : undefined,
  options.network)

const currentBlockNumber = await provider.getBlockNumber()
const currentBlock = await provider.getBlock(currentBlockNumber)
const currentBaseFeePerGas = currentBlock.baseFeePerGas
const maxBaseFeeInFutureBlock = flashbots.FlashbotsBundleProvider.getMaxBaseFeeInFutureBlock(
  currentBaseFeePerGas, futureBlocks + maxTries - 1)


console.log(`Current block number: ${currentBlockNumber}`)
console.log(`Current base fee: ${ethers.utils.formatUnits(currentBaseFeePerGas, "gwei")}`)

if (minMaxFeeInBundle.lt(maxBaseFeeInFutureBlock)) {
  console.log(`Min bundle fee ${ethers.utils.formatUnits(minMaxFeeInBundle, "gwei")} < max future base fee ${ethers.utils.formatUnits(maxBaseFeeInFutureBlock, "gwei")}`)
  process.exit(0)
}

if (options.dryRun) {
  const targetBlockNumber = currentBlockNumber + futureBlocks
  console.log(`Target block number: ${targetBlockNumber}`)
  const signedBundle = await flashbotsProvider.signBundle(bundle)
  const simulation = await flashbotsProvider.simulate(signedBundle, targetBlockNumber)
  console.log(JSON.stringify(simulation, null, 2))
  const bundlePricing = flashbotsProvider.calculateBundlePricing(simulation.results, currentBlock.baseFeePerGas)
  console.log(JSON.stringify(bundlePricing, null, 2))
}
else {
  const targetBlockNumbers = []
  const promises = []
  for (let targetBlockNumber = currentBlockNumber + futureBlocks; targetBlockNumber < currentBlockNumber + futureBlocks + maxTries; targetBlockNumber++) {
    targetBlockNumbers.push(targetBlockNumber)
    promises.push(flashbotsProvider.sendBundle(bundle, targetBlockNumber))
  }
  const submissions = await Promise.all(promises)
  const failures = []
  for (const [i, targetBlockNumber] of targetBlockNumbers.entries()) {
    const submission = submissions[i]
    console.log(`Target block number: ${targetBlockNumber}`)
    if ('error' in submission) {
      console.log(`RelayResponseError ${JSON.stringify(submission)}`)
    }
    else {
      const resolution = await submission.wait()
      console.log(`Resolution: ${flashbots.FlashbotsBundleResolution[resolution]}`)
      if (resolution === flashbots.FlashbotsBundleResolution.BlockPassedWithoutInclusion) {
        if (options.network === 'mainnet') {
          failures.push([submission, targetBlockNumber])
        }
      }
      else {
        process.exit(0)
      }
    }
  }
  if (failures.length) {
    console.log('User stats:')
    const userStats = await flashbotsProvider.getUserStats()
    console.log(JSON.stringify(userStats, null, 2))
    for (const [submission, targetBlockNumber] of failures) {
      const signedBundle = submission.bundleTransactions.map(a => a.signedTransaction)
      const conflictReport = await flashbotsProvider.getConflictingBundle(signedBundle, targetBlockNumber)
      console.log(`Conflict report for ${targetBlockNumber}: ${flashbots.FlashbotsBundleConflictType[conflictReport.conflictType]}`)
      console.log(JSON.stringify(conflictReport, null, 2))
      /*
      console.log('Bundle stats:')
      const bundleStats = await flashbotsProvider.getBundleStats(submission.bundleHash, targetBlockNumber)
      console.log(JSON.stringify(bundleStats, null, 2))
      */
    }
  }
}
})()
