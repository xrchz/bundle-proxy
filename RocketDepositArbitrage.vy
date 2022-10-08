# @version ^0.3.7

interface RocketStorageInterface:
  def getAddress(_key: bytes32) -> address: view

interface RocketDepositPoolInterface:
  def deposit(): payable

interface WethInterface:
  def balanceOf(_guy: address) -> uint256: view
  def deposit(): payable
  def withdraw(_wad: uint256): nonpayable

interface RethInterface:
  def approve(_spender: address, _amount: uint256) -> bool: nonpayable
  def balanceOf(_guy: address) -> uint256: view
  def transfer(_to: address, _amount: uint256) -> bool: nonpayable

struct ExactInputSingleParams:
  tokenIn: address
  tokenOut: address
  fee: uint24
  recipient: address
  deadline: uint256
  amountIn: uint256
  amountOutMinimum: uint256
  sqrtPriceLimitX96: uint160

interface SwapRouter:
  def exactInputSingle(params: ExactInputSingleParams) -> uint256: nonpayable

DEFAULT_FEE: constant(uint24) = 500

owner: public(address)

rocketStorage: immutable(RocketStorageInterface)
rethToken: immutable(RethInterface)
wethToken: immutable(WethInterface)
swapRouter: immutable(SwapRouter)

@external
def __init__(wethAddress: address, rocketStorageAddress: address, swapRouterAddress: address):
  self.owner = msg.sender
  rocketStorage = RocketStorageInterface(rocketStorageAddress)
  rethAddress: address = rocketStorage.getAddress(keccak256("contract.addressrocketTokenRETH"))
  rethToken = RethInterface(rethAddress)
  wethToken = WethInterface(wethAddress)
  swapRouter = SwapRouter(swapRouterAddress)

@external
def setOwner(newOwner: address):
  assert msg.sender == self.owner, "only owner can set owner"
  self.owner = newOwner

@external
def defund():
  assert msg.sender == self.owner, "only owner can defund"

  wethBalance: uint256 = wethToken.balanceOf(self)
  rethBalance: uint256 = rethToken.balanceOf(self)

  if 0 < wethBalance:
    wethToken.withdraw(wethBalance)

  if 0 < rethBalance:
    rethToken.transfer(self.owner, rethBalance)

  if 0 < self.balance:
    send(self.owner, self.balance)

@external
@payable
def fund():
  wethToken.deposit(value = self.balance)

@external
@payable
def __default__():
  assert msg.sender == wethToken.address, "only WETH can send ETH; use fund() instead"

# Require 16 (or wethAmount) WETH balance,
# Mint rETH with Rocket Pool at protocol rate,
# Swap rETH for WETH on Uniswap (approve Uniswap to spend rETH, execute swap),
# Return ETH profit to caller
@external
def arb(uniswapFee: uint24 = DEFAULT_FEE,
        wethAmount: uint256 = as_wei_value(16, "ether")):
  assert wethToken.balanceOf(self) >= wethAmount, "not enough WETH, please fund()"

  wethToken.withdraw(wethAmount)

  rocketDepositPool: RocketDepositPoolInterface = RocketDepositPoolInterface(
    rocketStorage.getAddress(keccak256("contract.addressrocketDepositPool")))

  rethBefore: uint256 = rethToken.balanceOf(self)

  rocketDepositPool.deposit(value = wethAmount)

  rethAfter: uint256 = rethToken.balanceOf(self)

  assert rethAfter >= rethBefore, "minted rETH missing"

  rethAmount: uint256 = rethAfter - rethBefore

  assert rethToken.approve(swapRouter.address, rethAmount), "rETH approve failed"

  swapParams: ExactInputSingleParams = ExactInputSingleParams({
    tokenIn: rethToken.address,
    tokenOut: wethToken.address,
    fee: uniswapFee,
    recipient: self,
    deadline: block.timestamp,
    amountIn: rethAmount,
    amountOutMinimum: wethAmount,
    sqrtPriceLimitX96: 0,
  })

  amountOut: uint256 = swapRouter.exactInputSingle(swapParams)

  assert amountOut > wethAmount, "no profit"

  profit: uint256 = amountOut - wethAmount

  wethToken.withdraw(profit)

  send(msg.sender, profit)
