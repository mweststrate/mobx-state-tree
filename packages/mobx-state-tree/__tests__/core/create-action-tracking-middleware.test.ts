import { addMiddleware, createActionTrackingMiddleware, types, flow } from "../../src"

const middleware = createActionTrackingMiddleware({
    onStart: () => {},
    onResume: () => {},
    onSuspend: () => {},
    onSuccess: () => {},
    onFail: () => {}
})

const M = types
    .model({})
    .actions(self => ({
        innerFlow: flow(function*() {
            yield new Promise(resolve => setTimeout(resolve))
            return true
        })
    }))
    .actions(self => ({
        outerFlow: flow(function*() {
            yield self.innerFlow()
            return true
        })
    }))

test("can handle inner flow", async () => {
    const m = M.create()
    addMiddleware(m, middleware)
    await expect(m.innerFlow()).resolves.toBe(true)
})

test("can handle outer flow", async () => {
    const m = M.create()
    addMiddleware(m, middleware)
    await expect(m.outerFlow()).resolves.toBe(true)
})
