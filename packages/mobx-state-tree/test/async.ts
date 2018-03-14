import {
    types,
    addMiddleware,
    recordActions,
    flow,
    decorate
    // TODO: export IRawActionCall
} from "../src"
import { reaction, useStrict } from "mobx"
function delay(time, value, shouldThrow = false) {
    return new Promise((resolve, reject) => {
        setTimeout(() => {
            if (shouldThrow) reject(value)
            else resolve(value)
        }, time)
    })
}
function testCoffeeTodo(done, generator, shouldError, resultValue, producedCoffees) {
    useStrict(true)
    const Todo = types
        .model({
            title: "get coffee"
        })
        .actions(self => ({
            startFetch: flow(generator(self)) as (string) => Promise<string>
        }))
    const events: any[] = []
    const coffees: any[] = []
    const t1 = Todo.create({})
    addMiddleware(t1, (c, next) => {
        events.push(c)
        return next(c)
    })
    reaction(() => t1.title, coffee => coffees.push(coffee))
    function handleResult(res) {
        expect(res).toBe(resultValue)
        expect(coffees).toEqual(producedCoffees)
        const filtered = filterRelevantStuff(events)
        expect(filtered).toMatchSnapshot()
        useStrict(false)
        done()
    }
    t1.startFetch("black").then(
        r => {
            expect(shouldError).toBe(false)
            handleResult(r)
        },
        r => {
            expect(shouldError).toBe(true)
            handleResult(r)
        }
    )
}
test("flow happens in single ticks", done => {
    const X = types
        .model({
            y: 1
        })
        .actions(self => ({
            p: flow(function*() {
                self.y++
                self.y++
                yield delay(1, true, false)
                self.y++
                self.y++
            })
        }))
    const x = X.create()
    const values: any[] = []
    reaction(() => x.y, v => values.push(v))
    x.p().then(() => {
        expect(x.y).toBe(5)
        expect(values).toEqual([3, 5])
        done()
    })
})
test("can handle async actions", done => {
    testCoffeeTodo(
        done,
        self =>
            function* fetchData(kind) {
                self.title = "getting coffee " + kind
                self.title = yield delay(100, "drinking coffee")
                return "awake"
            },
        false,
        "awake",
        ["getting coffee black", "drinking coffee"]
    )
})
test("can handle erroring actions", done => {
    testCoffeeTodo(
        done,
        self =>
            function* fetchData(kind) {
                throw kind
            },
        true,
        "black",
        []
    )
})
test("can handle try catch", t => {
    testCoffeeTodo(
        t,
        self =>
            function* fetchData(kind) {
                try {
                    yield delay(10, "tea", true)
                } catch (e) {
                    self.title = e
                    return "biscuit"
                }
            },
        false,
        "biscuit",
        ["tea"]
    )
})
test("empty sequence works", t => {
    testCoffeeTodo(t, self => function* fetchData(kind) {}, false, undefined, [])
})
test("can handle throw from yielded promise works", t => {
    testCoffeeTodo(
        t,
        self =>
            function* fetchData(kind) {
                yield delay(10, "x", true)
            },
        true,
        "x",
        []
    )
})
test("typings", done => {
    const M = types
        .model({
            title: types.string
        })
        .actions(self => {
            function* a(x) {
                yield delay(10, "x", false)
                self.title = "7"
                return 23
            }
            const b = flow(function* b(x) {
                yield delay(10, "x", false)
                self.title = "7"
                return 24
            })
            return { a: flow(a), b }
        })
    const m1 = M.create({ title: "test " })
    const resA = m1.a("z") // Arg typings are correct. TODO: Result type is incorrect; any
    const resB = m1.b("z") // Arg typings are correct, TODO: Result is correctly promise, but incorrect generic arg
    Promise.all([resA, resB]).then(([x1, x2]) => {
        expect(x1).toBe(23)
        expect(x2).toBe(24)
        done()
    })
})
test("typings", done => {
    const M = types
        .model({
            title: types.string
        })
        .actions(self => {
            function* a(x) {
                yield delay(10, "x", false)
                self.title = "7"
                return 23
            }
            const b = flow(function* b(x) {
                yield delay(10, "x", false)
                self.title = "7"
                return 24
            })
            return {
                a: flow(a),
                b
            }
        })
    const m1 = M.create({ title: "test " })
    const resA = m1.a("z") // Arg typings are correct. TODO: Result type is incorrect; any
    const resB = m1.b("z") // Arg typings are correct, TODO: Result is correctly promise, but incorrect generic arg
    Promise.all([resA, resB]).then(([x1, x2]) => {
        expect(x1).toBe(23)
        expect(x2).toBe(24)
        done()
    })
})
test("recordActions should only emit invocation", done => {
    let calls = 0
    const M = types
        .model({
            title: types.string
        })
        .actions(self => {
            function* a(x) {
                yield delay(10, "x", false)
                calls++
                return 23
            }
            return {
                a: flow(a)
            }
        })
    const m1 = M.create({ title: "test " })
    const recorder = recordActions(m1)
    m1.a("x").then(() => {
        recorder.stop()
        expect(recorder.actions).toEqual([
            {
                args: ["x"],
                name: "a",
                path: ""
            }
        ])
        expect(calls).toBe(1)
        recorder.replay(m1)
        setTimeout(() => {
            expect(calls).toBe(2)
            done()
        }, 50)
    })
})
test("can handle nested async actions", t => {
    const uppercase = flow(function* uppercase(value) {
        const res = yield delay(20, value.toUpperCase())
        return res
    })
    testCoffeeTodo(
        t,
        self =>
            function* fetchData(kind) {
                self.title = yield uppercase("drinking " + kind)
                return self.title
            },
        false,
        "DRINKING BLACK",
        ["DRINKING BLACK"]
    )
})
test("can handle nested async actions when using decorate", done => {
    const events: any[] = []
    function middleware(call, next) {
        events.push([call.type, call.name])
        return next(call)
    }
    const uppercase = flow(function* uppercase(value) {
        const res = yield delay(20, value.toUpperCase())
        return res
    })
    const Todo = types.model({}).actions(self => {
        const act = flow(function* act(value) {
            return yield uppercase(value)
        })
        return {
            act: decorate(middleware, act)
        }
    })
    Todo.create()
        .act("x")
        .then(res => {
            expect(res).toBe("X")
            expect(events).toEqual([
                ["action", "act"],
                ["flow_spawn", "act"],
                ["flow_resume", "act"],
                ["flow_resume", "act"],
                ["flow_return", "act"]
            ])
            done()
        })
})
function filterRelevantStuff(stuff) {
    return stuff.map(x => {
        delete x.context
        delete x.tree
        return x
    })
}

test("flows can be cancelled - 1 - uncatched cancellation", done => {
    let steps = 0
    const M = types.model({}).actions(self => ({
        start: flow(function*() {
            steps = 1
            yield Promise.resolve()
            steps = 2
        })
    }))

    const m = M.create()
    const promise = m.start()
    promise.then(
        () => fail(),
        err => {
            expect(steps).toBe(1)
            expect("" + err).toBe("Error: FLOW_CANCELLED")
            done()
        }
    )
    promise.cancel()
})

test("flows can be cancelled - 2 - catch cancellation in generator", done => {
    let steps = 0
    const M = types.model({}).actions(self => ({
        start: flow(function*() {
            steps = 1
            try {
                yield Promise.resolve()
                steps = 2
            } catch (e) {
                expect(steps).toBe(1)
                expect(e.toString()).toBe("Error: FLOW_CANCELLED")
                return 4
            }
        })
    }))

    const m = M.create()
    const promise = m.start()
    promise.then(
        res => {
            expect(res).toBe(4)
            done()
        },
        err => {
            fail()
        }
    )
    promise.cancel()
})

test("flows can be cancelled - 3 - rethrow cancellation", done => {
    let steps = 0
    const M = types.model({}).actions(self => ({
        start: flow(function*() {
            steps = 1
            try {
                yield Promise.resolve()
                steps = 2
            } catch (e) {
                expect(steps).toBe(1)
                expect(e.toString()).toBe("Error: FLOW_CANCELLED")
                throw e // rethrow
            }
        })
    }))

    const m = M.create()
    const promise = m.start()
    promise.then(
        () => fail(),
        err => {
            expect(steps).toBe(1)
            expect("" + err).toBe("Error: FLOW_CANCELLED")
            done()
        }
    )
    promise.cancel()
})

test("flows can be cancelled - 3 - pending Promise will be ignored", done => {
    let steps = 0
    const M = types.model({}).actions(self => ({
        start: flow(function*() {
            steps = 1
            try {
                yield Promise.reject("This won't be catched anywhere!") // cancel will resolve this flow before this one is throw, so this promise goes uncatched
                steps = 2
            } catch (e) {
                expect(steps).toBe(1)
                expect(e.toString()).toBe("Error: FLOW_CANCELLED")
                throw e
            }
        })
    }))

    const m = M.create()
    const promise = m.start()
    promise.then(
        () => fail(),
        err => {
            expect(steps).toBe(1)
            expect("" + err).toBe("Error: FLOW_CANCELLED")
            done()
        }
    )
    promise.cancel()
})
