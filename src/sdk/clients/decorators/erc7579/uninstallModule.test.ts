import {
  type Address,
  type Hex,
  decodeFunctionData,
  encodeAbiParameters,
  parseAbi
} from "viem"
import { describe, expect, test, vi } from "vitest"
import { uninstallModule } from "./uninstallModule"
import { uninstallModules } from "./uninstallModules"

// Offline: getAction() picks up `sendUserOperation` from the client and
// `readContract` from the account's public client, so no RPC or bundler is
// involved.
const ACCOUNT: Address = "0x1111111111111111111111111111111111111111"
const SENTINEL: Address = "0x0000000000000000000000000000000000000001"
const VALIDATOR_A: Address = "0x2222222222222222222222222222222222222222"
const VALIDATOR_B: Address = "0x3333333333333333333333333333333333333333"
const EXECUTOR_A: Address = "0x4444444444444444444444444444444444444444"
const EXECUTOR_B: Address = "0x5555555555555555555555555555555555555555"
const HOOK: Address = "0x6666666666666666666666666666666666666666"
const HOOK_DATA: Hex = "0xdeadbeef"

const accountAbi = parseAbi([
  "function uninstallModule(uint256 moduleTypeId, address module, bytes deInitData)"
])

const prevAndData = (prev: Address, data: Hex = "0x") =>
  encodeAbiParameters(
    [
      { name: "prev", type: "address" },
      { name: "disableModuleData", type: "bytes" }
    ],
    [prev, data]
  )

type SentUserOperation = { calls: { to: Address; data: Hex }[] }

const makeClient = () => {
  const readContract = vi.fn(
    async ({ functionName }: { functionName: string }) =>
      functionName === "getValidatorsPaginated"
        ? [[VALIDATOR_A, VALIDATOR_B], SENTINEL]
        : [[EXECUTOR_A, EXECUTOR_B], SENTINEL]
  )
  const sendUserOperation = vi.fn(
    async (_args: SentUserOperation) => "0x01" as Hex
  )
  const client = {
    account: { address: ACCOUNT, type: "smart", client: { readContract } },
    sendUserOperation
  } as unknown as Parameters<typeof uninstallModule>[0]
  return { client, readContract, sendUserOperation }
}

const sentArgs = (
  sendUserOperation: ReturnType<typeof makeClient>["sendUserOperation"]
) =>
  sendUserOperation.mock.calls[0][0].calls.map(
    (call) => decodeFunctionData({ abi: accountAbi, data: call.data }).args
  )

describe("uninstallModule", () => {
  test("validator: deInitData is abi.encode(prev, data)", async () => {
    const { client, sendUserOperation } = makeClient()
    await uninstallModule(client, {
      module: { type: "validator", address: VALIDATOR_B }
    })
    expect(sentArgs(sendUserOperation)).toEqual([
      [1n, VALIDATOR_B, prevAndData(VALIDATOR_A)]
    ])
  })

  test("validator at the head of the list uses the sentinel as prev", async () => {
    const { client, sendUserOperation } = makeClient()
    await uninstallModule(client, {
      module: { type: "validator", address: VALIDATOR_A }
    })
    expect(sentArgs(sendUserOperation)).toEqual([
      [1n, VALIDATOR_A, prevAndData(SENTINEL)]
    ])
  })

  test("executor: prev comes from the installed executors", async () => {
    const { client, readContract, sendUserOperation } = makeClient()
    await uninstallModule(client, {
      module: { type: "executor", address: EXECUTOR_B, initData: "0x1234" }
    })
    expect(readContract.mock.calls[0][0].functionName).toBe(
      "getExecutorsPaginated"
    )
    expect(sentArgs(sendUserOperation)).toEqual([
      [2n, EXECUTOR_B, prevAndData(EXECUTOR_A, "0x1234")]
    ])
  })

  test("hook: data is passed through without a prev lookup", async () => {
    const { client, readContract, sendUserOperation } = makeClient()
    await uninstallModule(client, {
      module: { type: "hook", address: HOOK, initData: HOOK_DATA }
    })
    expect(readContract).not.toHaveBeenCalled()
    expect(sentArgs(sendUserOperation)).toEqual([[4n, HOOK, HOOK_DATA]])
  })

  test("an explicit deInitData is used as is", async () => {
    const { client, readContract, sendUserOperation } = makeClient()
    const deInitData = prevAndData(SENTINEL, "0xaa")
    await uninstallModule(client, {
      module: { type: "validator", address: VALIDATOR_B, deInitData }
    })
    expect(readContract).not.toHaveBeenCalled()
    expect(sentArgs(sendUserOperation)).toEqual([[1n, VALIDATOR_B, deInitData]])
  })
})

describe("uninstallModules", () => {
  test("encodes each module the same way as uninstallModule", async () => {
    const { client, sendUserOperation } = makeClient()
    await uninstallModules(client, {
      modules: [
        { type: "validator", address: VALIDATOR_B },
        { type: "executor", address: EXECUTOR_A },
        { type: "hook", address: HOOK, initData: HOOK_DATA }
      ]
    })
    expect(sentArgs(sendUserOperation)).toEqual([
      [1n, VALIDATOR_B, prevAndData(VALIDATOR_A)],
      [2n, EXECUTOR_A, prevAndData(SENTINEL)],
      [4n, HOOK, HOOK_DATA]
    ])
  })
})
