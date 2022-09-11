# Requirements
npm, nodejs

# Installation
1. Run `npm install` in the current directory

The steps below are written assuming you install this package on the same
machine as your smartnode, and that you have ssh access to that machine from a
machine where you can use a browser with Metamask (to use the staking website).

# Atomically deposit a minipool and mint rETH

## Capture a deposit transaction
1. Find your execution client RPC address. Typically this will be `localhost:8545`.
2. Run the bundle proxy RPC: `node bundle-proxy.js --rpc <your execution client RPC address>`.
   (Leave this running and open another shell.)
3. Change your smartnode execution client RPC address to the proxy, e.g., `localhost:8549`, using
   the `rocketpool service config` TUI.
4. Create the deposit transaction `rocketpool node deposit`.
   After yes to the final 'ARE YOU SURE...?' it will hang: kill the process (CTRL-C).
5. Save the recorded hash (after `Captured eth_sendRawTransaction`) output by the proxy in `txs.txt`.
6. Change your smartnode execution client RPC back to normal.

## Capture a stake/mint transaction
1. Add a Metamask RPC representing the bundle proxy RPC.
   E.g., ssh with port forwarding into your node machine with `ssh -L 8549:localhost:8549 <your node>`,
   then add Metamask network with address `http://localhost:8549`.
2. Switch networks to the newly added network.
3. Go to <https://stake.rocketpool.net>, connect your Metamask wallet, and attempt to make the deposit transaction.
4. Save (append a new line) the recorded hash (after `Capture eth_sendRawTransaction`) output by the proxy in `txs.txt`.
5. Clear the queued transaction from Metamask: Settings -> Advanced -> Reset Account.
6. Ensure the transaction is gone, and switch Metamask networks back to normal. Now you can kill the bundle proxy RPC.

## Send the bundle to Flashbots
1. Run `node bundle-submit.js` to attempt to submit the bundle of 2 transactions saved in `txs.txt`; add `--help` to see more options.
2. Wait for the bundle to be accepted (`BundleIncluded`).
   Congratulations you have now made a deposit and minted the rETH it unlocked at the protocol rate!

## Import the validator keys
1. Rebuild validator keys using the smartnode: `rocketpool wallet rebuild`.

# Atomically exit a minipool and burn rETH
TODO
