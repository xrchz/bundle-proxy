const { program } = require('commander')
const tiny = require('tiny-json-http')

program.option('-p, --port <port>', 'port to listen on', '8549')
       .option('-r, --rpc <url>', 'URL of base RPC server', 'http://localhost:8545')
       .option('--overrideNonce <nonce>', 'rewrite responses to transaction count requests with this nonce')
program.parse()
const options = program.opts()
const url = options.rpc

const express = require('express')
const cors = require('cors')

const app = express()
app.use(express.json())
app.use(cors())

app.post('/', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body
  if (method === 'eth_sendTransaction') {
    console.log(`Captured sendTransaction:\n${JSON.stringify(params)}`)
  }
  else if (method === 'eth_sendRawTransaction') {
    console.log(`Captured sendRawTransaction:\n${params[0]}`)
  }
  else if (options.overrideNonce && method === 'eth_getTransactionCount') {
    // console.log(`Proxying data: ${JSON.stringify(req.body)}`)
    const result = (await tiny.post({url, data:req.body}))
    // console.log(`Received back: ${JSON.stringify(result.body)}`)
    // console.log('Overriding result')
    result.body.result = `0x${parseInt(options.overrideNonce).toString(16)}`
    // console.log(`Proxying back: ${JSON.stringify(result.body)}`)
    res.json(result.body)
  }
  else {
    // console.log(`Proxying data: ${JSON.stringify(req.body)}`)
    const result = (await tiny.post({url, data:req.body}))
    // console.log(`Proxying back: ${JSON.stringify(result.body)}`)
    res.json(result.body)
  }
})

app.listen(options.port)
