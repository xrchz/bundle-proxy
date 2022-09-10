const { program } = require('commander')
const tiny = require('tiny-json-http')

program.option('-p, --port <port>', 'port to listen on', '8549')
       .option('-r, --rpc <url>', 'URL of base RPC server', 'http://localhost:8545')
program.parse()
const options = program.opts()
const url = options.rpc

const express = require('express')

const app = express()
app.use(express.json())

app.post('/', async (req, res) => {
  const { jsonrpc, id, method, params } = req.body
  if (method == 'eth_sendTransaction') {
    console.log(`Got sendTransaction! params: ${JSON.stringify(params)}`)
  }
  else if (method == 'eth_sendRawTransaction') {
    console.log(`Got sendRawTransaction! params: ${JSON.stringify(params)}`)
  }
  else {
    // console.log(`Proxying data: ${JSON.stringify(req.body)}`)
    res.json((await tiny.post({url, data:req.body})).body)
  }
})

app.listen(options.port)
