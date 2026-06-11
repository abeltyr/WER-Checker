import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test"
import { logger, createLogger } from "../../../src/utils/logger"

let logSpy: ReturnType<typeof spyOn>
let warnSpy: ReturnType<typeof spyOn>
let errorSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  logSpy = spyOn(console, "log").mockImplementation(() => {})
  warnSpy = spyOn(console, "warn").mockImplementation(() => {})
  errorSpy = spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  logger.setLevel("info")
  logSpy.mockRestore()
  warnSpy.mockRestore()
  errorSpy.mockRestore()
})

describe("logger levels", () => {
  it("suppresses debug at the default info level", () => {
    logger.debug("test", "hidden message")
    expect(logSpy).not.toHaveBeenCalled()

    logger.info("test", "visible message")
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it("emits debug when the level is lowered", () => {
    logger.setLevel("debug")
    logger.debug("test", "now visible")
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it("suppresses info and warn at the error level", () => {
    logger.setLevel("error")
    logger.info("test", "hidden")
    logger.warn("test", "hidden")
    logger.error("test", "visible")

    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it("suppresses everything at the silent level", () => {
    logger.setLevel("silent")
    logger.debug("test", "x")
    logger.info("test", "x")
    logger.warn("test", "x")
    logger.error("test", "x")

    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

describe("log formatting", () => {
  it("includes the module name and message", () => {
    logger.info("my-module", "hello world")
    const output = String(logSpy.mock.calls[0]![0])
    expect(output).toContain("my-module")
    expect(output).toContain("hello world")
  })

  it("appends structured data as JSON", () => {
    logger.info("test", "with data", { count: 42 })
    const output = String(logSpy.mock.calls[0]![0])
    expect(output).toContain('"count":42')
  })
})

describe("createLogger", () => {
  it("binds the module name to every call", () => {
    const moduleLogger = createLogger("bound-module")
    moduleLogger.info("from module logger")
    moduleLogger.warn("warning")

    expect(String(logSpy.mock.calls[0]![0])).toContain("bound-module")
    expect(String(warnSpy.mock.calls[0]![0])).toContain("bound-module")
  })
})
