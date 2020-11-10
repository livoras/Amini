// tslint:disable: no-bitwise
// tslint:disable: no-big-function
// tslint:disable: cognitive-complexity
import { parseStringsArray, getByProp, readUInt8, readInt16, readUInt32, readFloat64, readInt8, getOperatantByBuffer, getOperantName } from "../utils"

export enum I {
 MOV, ADD, SUB, MUL, DIV, MOD,
 EXP, INC, DEC,

 LT, GT, EQ, LE, GE, NE, WEQ, WNE,
 LG_AND, LG_OR,
 AND, OR, XOR, SHL, SHR, ZSHR,

 JMP, JE, JNE, JG, JL, JIF, JF,
 JGE, JLE, PUSH, POP, CALL, PRINT,
 RET, PAUSE, EXIT,

 CALL_CTX, CALL_VAR, CALL_REG, MOV_CTX, MOV_PROP,
 SET_CTX, // SET_CTX "name" R1
 NEW_OBJ, NEW_ARR, NEW_REG, SET_KEY,
 FUNC, ALLOC,

 /* UnaryExpression */
 PLUS, // PLUS %r0 +
 MINUS, // MINUS %r0 -
 NOT, // NOT %r0 ~
 VOID, // VOID %r0 void
 DEL, // DEL %r0 %r1 delete
 NEG, // NEG %r0 !
 TYPE_OF,

 IN,
 INST_OF, // instanceof
 MOV_THIS, // moving this to resgister

 // try catch
 TRY, TRY_END, THROW,

 // arguments
 MOV_ARGS,
}

class VMRunTimeError extends Error {
  constructor(public error: any) {
    super(error)
  }
}

export const enum IOperatantType {
  REGISTER = 0 << 4,
  CLOSURE_REGISTER = 1 << 4,
  GLOBAL = 2 << 4,
  NUMBER = 3 << 4,
  // tslint:disable-next-line: no-identical-expressions
  FUNCTION_INDEX = 4 << 4,
  STRING = 5 << 4,
  ARG_COUNT = 6 << 4,
  RETURN_VALUE = 7 << 4,
  ADDRESS = 8 << 4,
  BOOLEAN = 9 << 4,
  NULL = 10 << 4,
  UNDEFINED = 11 << 4,
}

// tslint:disable-next-line: max-classes-per-file
class FunctionInfo {
  public vm?: VirtualMachine
  constructor(
    public ip: number,
    public numArgs: number,
    public localSize: number,
    public closureTable?: any,
    public jsFunction?: CallableFunction,
  ) {
  }

  public setVirtualMachine(vm: VirtualMachine): void {
    this.vm = vm
  }

  public getJsFunction(): CallableFunction {
    if (!this.vm) { throw new VMRunTimeError("VirtualMachine is not set!")}
    if (!this.closureTable) { this.closureTable = {} }
    // let jsFunc = this.jsFunction
    // if (!jsFunc) {
    //   jsFunc = this.jsFunction = parseVmFunctionToJsFunction(this, this.vm)
    // }
    this.jsFunction = parseVmFunctionToJsFunction(this, this.vm)
    return this.jsFunction as CallableFunction
  }

}

type CallableFunction = (...args: any[]) => any

export interface IOperant {
  type: IOperatantType,
  value: any,
  raw?: any,
  index?: any,
}

export type IClosureTable = {
  [x in number]: number
}

// tslint:disable-next-line: max-classes-per-file
export class VirtualMachine {
  /** 指令索引 */
  public ip: number = 0
  /** 当前函数帧基索引 */
  public fp: number = 0
  /** 操作的栈顶 */
  public sp: number = -1

  /** 寄存器 */
  public RET: any // 函数返回寄存器
  public REG: any // 通用寄存器

  /** 函数操作栈 */
  public stack: any[] = []

  /** 闭包变量存储 */
  public heap: any[] = []

  /** 闭包映射表 */
  public closureTable: any = {}
  public closureTables: any[] = []

  /** this 链 */
  public currentThis: any
  public allThis: any[] = []

  public isRunning: boolean = false

  constructor(
    public codes: ArrayBuffer,
    public functionsTable: FunctionInfo[],
    public stringsTable: string[],
    public entryFunctionIndex: number,
    public globalSize: number,
    public ctx: any,
  ) {
    this.init()
  }

  public init(): void {
    const { globalSize, functionsTable, entryFunctionIndex } = this
    // RET
    // TODO: how to deal with it?
    this.stack.splice(0)
    // this.heap = []
    const globalIndex = globalSize + 1
    const mainLocalSize = functionsTable[entryFunctionIndex].localSize
    this.fp = globalIndex // fp 指向 old fp 位置，兼容普通函数
    this.stack[this.fp] = -1
    this.sp = this.fp + mainLocalSize
    this.stack.length = this.sp + 1
    //
    this.closureTable = {}
    this.closureTables = [this.closureTable]
    //
    this.currentThis = this.ctx
    this.allThis = [this.currentThis]
    this.currentThis = this.ctx
    //
    this.functionsTable.forEach((funcInfo): void => { funcInfo.vm = this })

    /**
     * V2
     * V1 -> sp ->
     * <empty item>
     * ...
     * G2
     * G1
     * RET
     */
    console.log(
      "globalIndex", globalIndex,
      "localSize", functionsTable[entryFunctionIndex].localSize,
    )
    console.log("start ---> fp", this.fp, this.sp)
  }

  public reset(): void {
    this.init()
    // this.stack = []
    this.heap = []
  }

  // tslint:disable-next-line: no-big-function
  public run(): void {
    this.ip = this.functionsTable[this.entryFunctionIndex].ip
    console.log("start stack", this.stack)
    this.isRunning = true
    while (this.isRunning) {
      this.fetchAndExecute()
    }
  }

  public setReg(dst: IOperant, src: { value: any }): void {
    if (dst.type === IOperatantType.CLOSURE_REGISTER) {
      // console.log("SET closure", dst)
      this.heap[this.makeClosureIndex(dst.index)] = src.value
    } else {
      this.stack[dst.index] = src.value
    }
  }

  public getReg(operatant: IOperant): any {
    if (operatant.type === IOperatantType.CLOSURE_REGISTER) {
      // console.log("GET closure", operatant)
      return this.heap[this.makeClosureIndex(operatant.index)]
    } else {
      return this.stack[operatant.index]
    }
  }

  public makeClosureIndex = (index: number): number => {
    if (this.closureTable[index] === undefined) {
      this.closureTable[index] = this.heap.length
      this.heap.push(undefined)
    }
    return this.closureTable[index]
  }

  // tslint:disable-next-line: no-big-function cognitive-complexity
  public fetchAndExecute(): [I, boolean] {
    if (!this.isRunning) {
      throw new Error("try to run again...")
    }
    const stack = this.stack
    const op = this.nextOperator()
    // 用来判断是否嵌套调用 vm 函数
    let isCallVMFunction = false
    // console.log(op, I[op])
    // tslint:disable-next-line: max-switch-cases
    switch (op) {
    case I.PUSH: {
      this.push(this.nextOperant().value)
      break
    }
    case I.EXIT: {
      console.log("exit stack size -> ", stack.length)
      // console.log('stack -> ', this.stack)
      // console.log('heap -> ', this.heap)
      // console.log('closures -> ', this.closureTables)
      this.isRunning = false
      // this.closureTables = []
      // this.init()
      break
    }
    // case I.CALL: {
    //   const funcInfo: FunctionInfo = this.nextOperant().value
    //   const numArgs = this.nextOperant().value
    //   if (funcInfo instanceof )
    //   break
    // }
    case I.RET: {
      const fp = this.fp
      this.fp = stack[fp]
      this.ip = stack[fp - 1]
      // 减去参数数量，减去三个 fp ip numArgs args
      // console.log("args --- .leng", stack[fp -2], stack, stack[fp])
      this.sp = fp - stack[fp - 2] - 4
      // 清空上一帧
      this.stack.splice(this.sp + 1)
      this.closureTables.pop()
      this.closureTable = this.closureTables[this.closureTables.length - 1]
      //
      this.allThis.pop()
      this.currentThis = this.allThis[this.allThis.length - 1]
      break
    }
    case I.PRINT: {
      const val = this.nextOperant()
      console.log(val.value)
      break
    }
    case I.MOV: {
      const dst = this.nextOperant()
      const src = this.nextOperant()
      // console.log('MOV', dst, src)
      // this.stack[dst.index] = src.value
      this.setReg(dst, src)
      break
    }
    case I.JMP: {
      const address = this.nextOperant()
      this.ip = address.value
      break
    }
    case I.JE: {
      this.jumpWithCondidtion((a: any, b: any): boolean => a === b)
      break
    }
    case I.JNE: {
      this.jumpWithCondidtion((a: any, b: any): boolean => a !== b)
      break
    }
    case I.JG: {
      this.jumpWithCondidtion((a: any, b: any): boolean => a > b)
      break
    }
    case I.JL: {
      this.jumpWithCondidtion((a: any, b: any): boolean => a < b)
      break
    }
    case I.JGE: {
      this.jumpWithCondidtion((a: any, b: any): boolean => a >= b)
      break
    }
    case I.JLE: {
      this.jumpWithCondidtion((a: any, b: any): boolean => a <= b)
      break
    }
    case I.JIF: {
      const cond = this.nextOperant()
      const address = this.nextOperant()
      if (cond.value) {
        this.ip = address.value
      }
      break
    }
    case I.JF: {
      const cond = this.nextOperant()
      const address = this.nextOperant()
      if (!cond.value) {
        this.ip = address.value
      }
      break
    }
    case I.CALL_CTX:
    case I.CALL_VAR: {
      let o
      if (op === I.CALL_CTX) {
        o = this.ctx
      } else {
        o = this.nextOperant().value
      }
      const funcName = this.nextOperant().value
      const numArgs = this.nextOperant().value
      const isNewExpression = this.nextOperant().value
      // console.log(funcName, '--->', o, '--->', numArgs)
      isCallVMFunction = this.callFunction(void 0, o, funcName, numArgs, isNewExpression)
      break
    }
    case I.CALL_REG: {
      const o = this.nextOperant()
      const f = o.value
      const numArgs = this.nextOperant().value
      const isNewExpression = this.nextOperant().value
      // console.log(this.closureTable)
      isCallVMFunction = this.callFunction(f, void 0, "", numArgs, isNewExpression)
      break
    }
    case I.MOV_CTX: {
      const dst = this.nextOperant()
      const propKey = this.nextOperant()
      const src = getByProp(this.ctx, propKey.value)
      this.setReg(dst, { value: src })
      break
    }
    case I.SET_CTX: {
      const propKey = this.nextOperant()
      const val = this.nextOperant()
      this.ctx[propKey.value] = val.value
      break
    }
    case I.NEW_OBJ: {
      const dst = this.nextOperant()
      const o = {}
      this.setReg(dst, { value: o })
      break
    }
    case I.NEW_REG: {
      const dst = this.nextOperant()
      const pattern = this.nextOperant()
      const flags = this.nextOperant()
      // console.log(dst, pattern, flags)
      try {
        this.setReg(dst, { value: new RegExp(pattern.value, flags.value) })
      } catch (e) {
        console.log("================== pattern\n")
        console.log(pattern.value)
        console.log("==================\n")

        console.log("=================== value\n")
        console.log(flags.value)
        console.log("===================\n")
        throw new VMRunTimeError(e)
      }
      break
    }
    case I.NEW_ARR: {
      const dst = this.nextOperant()
      const o: any[] = []
      this.setReg(dst, { value: o })
      break
    }
    case I.SET_KEY: {
      const o = this.nextOperant().value
      const key = this.nextOperant().value
      const value = this.nextOperant().value
      // console.log(o, key, value)
      o[key] = value
      break
    }
    /** 这是定义一个函数 */
    case I.FUNC: {
      const dst = this.nextOperant()
      const funcOperant = this.nextOperant()
      const funcInfoIndex: number = funcOperant.raw
      const funcInfo = this.functionsTable[funcInfoIndex]
      // TODO
      // console.log(this.closureTable, '??????????????')
      funcInfo.closureTable = { ...this.closureTable }
      // stack[dst.index] = callback
      this.setReg(dst, { value: funcOperant.value })
      // console.log("++++++", dst, this.stack)
      break
    }
    // MOV_PRO R0 R1 "arr.length";
    case I.MOV_PROP: {
      const dst = this.nextOperant()
      const o = this.nextOperant()
      const k = this.nextOperant()
      const v = getByProp(o.value, k.value)
      this.setReg(dst, { value: v })
      break
    }
    case I.LT: {
      this.binaryExpression((a, b): any => a < b)
      break
    }
    case I.GT: {
      this.binaryExpression((a, b): any => a > b)
      break
    }
    case I.EQ: {
      this.binaryExpression((a, b): any => a === b)
      break
    }
    case I.NE: {
      this.binaryExpression((a, b): any => a !== b)
      break
    }
    case I.WEQ: {
      // tslint:disable-next-line: triple-equals
      this.binaryExpression((a, b): any => a == b)
      break
    }
    case I.WNE: {
      // tslint:disable-next-line: triple-equals
      this.binaryExpression((a, b): any => a != b)
      break
    }
    case I.LE: {
      this.binaryExpression((a, b): any => a <= b)
      break
    }
    case I.GE: {
      this.binaryExpression((a, b): any => a >= b)
      break
    }
    case I.ADD: {
      this.binaryExpression((a, b): any => a + b)
      break
    }
    case I.SUB: {
      this.binaryExpression((a, b): any => a - b)
      break
    }
    case I.MUL: {
      this.binaryExpression((a, b): any => a * b)
      break
    }
    case I.DIV: {
      this.binaryExpression((a, b): any => a / b)
      break
    }
    case I.MOD: {
      this.binaryExpression((a, b): any => a % b)
      break
    }
    case I.AND: {
      // tslint:disable-next-line: no-bitwise
      this.binaryExpression((a, b): any => a & b)
      break
    }
    case I.OR: {
      // tslint:disable-next-line: no-bitwise
      this.binaryExpression((a, b): any => a | b)
      break
    }
    case I.XOR: {
      // tslint:disable-next-line: no-bitwise
      this.binaryExpression((a, b): any => a ^ b)
      break
    }
    case I.SHL: {
      // tslint:disable-next-line: no-bitwise
      this.binaryExpression((a, b): any => a << b)
      break
    }
    case I.SHR: {
      // tslint:disable-next-line: no-bitwise
      this.binaryExpression((a, b): any => a >> b)
      break
    }
    case I.ZSHR: {
      // tslint:disable-next-line: no-bitwise
      this.binaryExpression((a, b): any => a >>> b)
      break
    }
    case I.LG_AND: {
      this.binaryExpression((a, b): any => a && b)
      break
    }
    case I.LG_OR: {
      this.binaryExpression((a, b): any => a || b)
      break
    }
    case I.INST_OF: {
      this.binaryExpression((a, b): any => {
        return a instanceof b
      })
      break
    }
    case I.IN: {
      this.binaryExpression((a, b): any => {
        return a in b
      })
      break
    }
    case I.ALLOC: {
      const dst = this.nextOperant()
      this.getReg(dst)
      break
    }
    case I.PLUS: {
      this.uniaryExpression((val: any): any => +val)
      break
    }
    case I.MINUS: {
      this.uniaryExpression((val: any): any => -val)
      break
    }
    case I.VOID: {
      // tslint:disable-next-line: no-unused-expression
      this.uniaryExpression((val: any): any => void val)
      break
    }
    case I.NOT: {
      // tslint:disable-next-line: no-bitwise
      this.uniaryExpression((val: any): any => ~val)
      break
    }
    case I.NEG: {
      // tslint:disable-next-line: no-bitwise
      this.uniaryExpression((val: any): any => !val)
      break
    }
    case I.TYPE_OF: {
      this.uniaryExpression((val: any): any => typeof val)
      break
    }
    case I.DEL: {
      const o1 = this.nextOperant().value
      const o2 = this.nextOperant().value
      delete o1[o2]
      break
    }
    case I.MOV_THIS: {
      this.setReg(this.nextOperant(), { value: this.currentThis })
      break
    }
    case I.TRY: {
      const catchAddress = this.nextOperant()
      const endAddress = this.nextOperant()
      while (true) {
        try {
          const o = this.fetchAndExecute()[0]
          if (o === I.TRY_END) {
            this.ip = endAddress.value
            break
          }
        } catch (e) {
          if (e instanceof VMRunTimeError) {
            throw e
          }
          this.ip = catchAddress.value
          break
          // } else {
          //   throw e
          // }
        }
      }
      break
    }
    case I.THROW: {
      const err = this.nextOperant()
      throw err.value
      // throw new VMRunTimeError(err)
      break
    }
    case I.TRY_END: {
      throw new VMRunTimeError("Should not has `TRY_END` here.")
      break
    }
    case I.MOV_ARGS: {
      const dst = this.nextOperant()
      // console.log(this.stack[this.fp - 2], '--->')
      this.setReg(dst, { value: this.stack[this.fp - 3] })
      break
    }
    default:
      console.log(this.ip)
      throw new VMRunTimeError("Unknow command " + op + " " + I[op], )
    }

    return [op, isCallVMFunction]
  }

  public push(val: any): void {
    this.stack[++this.sp] = val
  }

  public nextOperator(): I {
    // console.log("ip -> ", this.ip)
    return readUInt8(this.codes, this.ip, ++this.ip)
  }

  public nextOperant(): IOperant {
    const codes = this.codes
    const [operantType, value, byteLength] = getOperatantByBuffer(codes, this.ip++)
    this.ip = this.ip + byteLength
    return {
      type: operantType,
      value: this.parseValue(operantType, value),
      raw: value,
      index: operantType === IOperatantType.REGISTER ? (this.fp + value) : value,
    }
    // console.log('raw', ret, byteLength)
    // return ret
  }

  public parseValue(valueType: IOperatantType, value: any): any {
    switch (valueType) {
    case IOperatantType.CLOSURE_REGISTER:
      return this.heap[this.closureTable[value]]
    case IOperatantType.REGISTER:
      return this.stack[this.fp + value]
    case IOperatantType.ARG_COUNT:
    case IOperatantType.NUMBER:
    case IOperatantType.ADDRESS:
      return value
    case IOperatantType.GLOBAL:
      return this.stack[value]
    case IOperatantType.STRING:
      return this.stringsTable[value]
    case IOperatantType.FUNCTION_INDEX:
      return this.functionsTable[value].getJsFunction()
    case IOperatantType.RETURN_VALUE:
      return this.stack[0]
    case IOperatantType.BOOLEAN:
      return !!value
    case IOperatantType.NULL:
      return null
    case IOperatantType.UNDEFINED:
      return void 0
    default:
      throw new VMRunTimeError("Unknown operant " + valueType)
    }
  }

  public jumpWithCondidtion(cond: (a: any, b: any) => boolean): void {
    const op1 = this.nextOperant()
    const op2 = this.nextOperant()
    const address = this.nextOperant()
    if (cond(op1.value, op2.value)) {
      this.ip = address.value
    }
  }

  public uniaryExpression(exp: (a: any) => any): void {
    const o = this.nextOperant()
    const ret = exp(o.value)
    this.setReg(o, { value: ret })
  }

  public binaryExpression(exp: (a: any, b: any) => any): void {
    const o1 = this.nextOperant()
    const o2 = this.nextOperant()
    const ret = exp(o1.value, o2.value)
    this.setReg(o1, { value: ret })
  }

  // tslint:disable-next-line: cognitive-complexity
  public callFunction(
    func: CallableFunction | undefined,
    o: any,
    funcName: string,
    numArgs: number,
    isNewExpression: boolean,
  ): boolean {
    const stack = this.stack
    const f = func || o[funcName]
    let isCallVMFunction = false
    if ((f instanceof Callable) && !isNewExpression) {
      // console.log('---> THE IP IS -->', (func as any).__ip__)
      const arg = new NumArgs(numArgs)
      if (o) {
        if (typeof o[funcName] === "function") {
          o[funcName](arg)
        } else {
          throw new VMRunTimeError(`The fucking ${funcName} is not a function`)
        }
      } else {
        f(arg)
      }
      isCallVMFunction = true
    } else {
      const args = []
      for (let i = 0; i < numArgs; i++) {
        args.push(stack[this.sp--])
      }
      if (o) {
        try {
          stack[0] = isNewExpression
            ? new o[funcName](...args)
            : o[funcName](...args)
        } catch (e) {
          console.log(`Calling function "${funcName}" failed.`, typeof o)
          // console.trace(e)
          // if (!(e instanceof VMRunTimeError)) {
          throw new VMRunTimeError(e)
          // }
          // console.log(o[funcName]())
          // console.error(`Function '${funcName}' is not found.`, o)
          // throw e
        }
      } else {
        stack[0] = isNewExpression
          ? new f(...args)
          : f(...args)
      }
      this.stack.splice(this.sp + 1)
    }
    return isCallVMFunction
  }
}

/**
 * Header:
 *
 * mainFunctionIndex: 1
 * funcionTableBasicIndex: 1
 * stringTableBasicIndex: 1
 * globalsSize: 2
 */
const createImageFromArrayBuffer = (buffer: ArrayBuffer, ctx: any = {}): VirtualMachine => {
  const mainFunctionIndex = readUInt32(buffer, 0, 4)
  const funcionTableBasicIndex = readUInt32(buffer, 4, 8)
  const stringTableBasicIndex = readUInt32(buffer, 8, 12)
  const globalsSize = readUInt32(buffer, 12, 16)

  const stringsTable: string[] = parseStringsArray(buffer.slice(stringTableBasicIndex))
  const codesBuf = buffer.slice(4 * 4, funcionTableBasicIndex)
  const funcsBuf = buffer.slice(funcionTableBasicIndex, stringTableBasicIndex)
  const funcsTable: FunctionInfo[] = parseFunctionTable(funcsBuf)

  return new VirtualMachine(codesBuf, funcsTable, stringsTable, mainFunctionIndex, globalsSize, ctx)
}

const parseFunctionTable = (buffer: ArrayBuffer): FunctionInfo[] => {
  const funcs: FunctionInfo[] = []
  let i = 0
  while (i < buffer.byteLength) {
    const ipEnd = i + 4
    const ip = readUInt32(buffer, i, ipEnd)
    const numArgsAndLocal = new Uint16Array(buffer.slice(ipEnd, ipEnd + 2 * 2))
    funcs.push(
      new FunctionInfo(
        ip,
        numArgsAndLocal[0],
        numArgsAndLocal[1],
      ),
    )
    i += 8
  }
  return funcs
}

export { createImageFromArrayBuffer }

// https://hackernoon.com/creating-callable-objects-in-javascript-d21l3te1
// tslint:disable-next-line: max-classes-per-file
class Callable extends Function {
  constructor() {
    super()
  }
}

exports.Callable = Callable

// tslint:disable-next-line: max-classes-per-file
class NumArgs {
  constructor(public numArgs: number) {
  }
}

exports.NumArgs = NumArgs

function parseVmFunctionToJsFunction(
  funcInfo: FunctionInfo, vm: VirtualMachine): any {
  const func = function(this: any, ...args: any[]): any {
    vm.isRunning = true
    const n = args[0]
    const isCalledFromJs = !(n instanceof NumArgs)
    let numArgs = 0
    let allArgs = []
    if (isCalledFromJs) {
      args.reverse()
      args.forEach((arg: any): void => vm.push(arg))
      numArgs = args.length
      allArgs = [...args]
    } else {
      numArgs = n.numArgs
      allArgs = []
      for (let i = 0; i < numArgs; i++) {
        allArgs.push(vm.stack[vm.sp - i])
        // console.log(arguments, '--->')
      }
    }
    // console.log("CALLING ---->", funcInfo)
    vm.closureTable = funcInfo.closureTable
    vm.closureTables.push(funcInfo.closureTable)
    vm.currentThis = this
    vm.allThis.push(this)
    const stack = vm.stack
    if (isCalledFromJs) {
      stack[0] = undefined
    }
    // console.log('call', funcInfo, numArgs)
    //            | R3        |
    //            | R2        |
    //            | R1        |
    //            | R0        |
    //      sp -> | fp        | # for restoring old fp
    //            | ip        | # for restoring old ip
    //            | numArgs   | # for restoring old sp: old sp = current sp - numArgs - 3
    //            | arguments | # for store arguments for js `arguments` keyword
    //            | arg1      |
    //            | arg2      |
    //            | arg3      |
    //  old sp -> | ....      |
    stack[++vm.sp] = allArgs
    stack[++vm.sp] = numArgs
    stack[++vm.sp] = vm.ip
    stack[++vm.sp] = vm.fp
    // set to new ip and fp
    vm.ip = funcInfo.ip
    vm.fp = vm.sp
    vm.sp += funcInfo.localSize
    if (isCalledFromJs) {
      /** 嵌套 vm 函数调 vm 函数，需要知道嵌套多少层，等到当前层完结再返回 */
      let callCount = 1
      while (callCount > 0 && vm.isRunning) {
        const [op, isCallVMFunction] = vm.fetchAndExecute()
        if (isCallVMFunction) {
          callCount++
        } else if (op === I.RET) {
          callCount--
        }
      }
      return stack[0]
    }
  }
  Object.setPrototypeOf(func, Callable.prototype)
  return func
}
// tslint:disable-next-line: max-file-line-count
