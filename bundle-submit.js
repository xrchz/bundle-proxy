require('dotenv').config()
const { program } = require('commander')
program.option('-i, --maxPrioFee <gwei>', 'maximum priority fee', '2')
       .option('-f, --futureBlocks <n>', 'number of blocks after current to target', '1')
       .option('-c, --network <name>', 'network (chain)', 'mainnet')
       .option('-t, --txFile <file>', 'file containing lines of signed transactions', 'txs.txt')
       .option('-n, --dryRun', 'simulate bundle only')
program.parse()
const options = program.opts()

const bundle = require('fs')
  .readFileSync(options.txFile, 'utf-8')
  .split('\n').slice(0,-1)
  .map(tx => ({signedTransaction: tx}))
console.log(`Bundle:\n${JSON.stringify(bundle,null,2)}`)
const ethers = require('ethers')

const GWEI = ethers.BigNumber.from(10).pow(9)
const PRIORITY_FEE = GWEI.mul(options.maxPrioFee)
const BLOCKS_IN_FUTURE = parseInt(options.futureBlocks)

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
const targetBlockNumber = currentBlockNumber + BLOCKS_IN_FUTURE
const currentBlock = await provider.getBlock(currentBlockNumber)
const maxBaseFeeInFutureBlock = flashbots.FlashbotsBundleProvider.getMaxBaseFeeInFutureBlock(
  currentBlock.baseFeePerGas, BLOCKS_IN_FUTURE)

console.log(`Current block number: ${currentBlockNumber}`)
console.log(`Current base fee: ${currentBlock.baseFeePerGas}`)
console.log(`Target block number: ${targetBlockNumber}`)
console.log(`Max fee per gas: ${maxBaseFeeInFutureBlock.add(options.maxPrioFee).toString()} gwei`)

if (options.dryRun) {
  const signedBundle = await flashbotsProvider.signBundle(bundle)
  const simulation = await flashbotsProvider.simulate(signedBundle, targetBlockNumber)
  console.log(JSON.stringify(simulation, null, 2))
  const bundlePricing = flashbotsProvider.calculateBundlePricing(simulation.results, currentBlock.baseFeePerGas)
  console.log(JSON.stringify(bundlePricing, null, 2))
}
else {
  const submission = await flashbotsProvider.sendBundle(bundle, targetBlockNumber)
  if ('error' in submission) {
    console.log(`RelayResponseError ${JSON.stringify(submission)}`)
  }
  else {
    const resolution = await submission.wait()
    console.log(`Resolution: ${flashbots.FlashbotsBundleResolution[resolution]}`)
  }
}

})()
