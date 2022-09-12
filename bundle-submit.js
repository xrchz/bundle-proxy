const { program } = require('commander')
program.option('-m, --maxTries <m>', 'number of blocks to attempt to submit the bundle for', '10')
       .option('-r, --rpc <url>', 'RPC provider', 'http://localhost:8545')
       .option('-t, --txFile <file>', 'file containing lines of signed transactions', 'txs.txt')
       .option('-a, --authSignerKey <privateKey>', 'optional key for flashbots reputation')
       .option('-n, --dryRun', 'simulate bundle only')
program.parse()
const options = program.opts()

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

const provider = ethers.getDefaultProvider(options.rpc);

const authSigner = options.authSignerKey ?
  new ethers.Wallet(options.authSignerKey) :
  ethers.Wallet.createRandom()

;(async () => {
const network = await provider.getNetwork()
const flashbotsProvider = await flashbots.FlashbotsBundleProvider.create(
  provider,
  authSigner,
  network.chainId === 5 ? 'https://relay-goerli.flashbots.net/' : undefined,
  network.name)

const currentBlockNumber = await provider.getBlockNumber()
const currentBlock = await provider.getBlock(currentBlockNumber)
const currentBaseFeePerGas = currentBlock.baseFeePerGas
const maxBaseFeeInFutureBlock = flashbots.FlashbotsBundleProvider.getMaxBaseFeeInFutureBlock(
  currentBaseFeePerGas, maxTries)


console.log(`Current block number: ${currentBlockNumber}`)
console.log(`Current base fee: ${ethers.utils.formatUnits(currentBaseFeePerGas, "gwei")}`)

if (minMaxFeeInBundle.lt(maxBaseFeeInFutureBlock)) {
  console.log(`Min bundle fee ${ethers.utils.formatUnits(minMaxFeeInBundle, "gwei")} < max future base fee ${ethers.utils.formatUnits(maxBaseFeeInFutureBlock, "gwei")}`)
  process.exit(0)
}

if (options.dryRun) {
  const targetBlockNumber = currentBlockNumber + 1
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
  for (let targetBlockNumber = currentBlockNumber + 1; targetBlockNumber <= currentBlockNumber + maxTries; targetBlockNumber++) {
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
        if (network.chainId === 1) {
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
