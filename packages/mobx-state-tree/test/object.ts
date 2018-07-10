import { unprotect } from "../src/core/mst-operations"
import {
    destroy,
    detach,
    onSnapshot,
    onPatch,
    onAction,
    applyPatch,
    applyAction,
    applySnapshot,
    getSnapshot,
    process,
    types
} from "../src"
import { autorun, reaction, observable } from "mobx"

const createTestFactories = () => {
    const Factory = types
        .model({
            to: "world"
        })
        .actions(self => {
            function setTo(to) {
                self.to = to
                return to
            }

            const asyncSetTo = process(function* asyncSetTo(to) {
                self.to = yield Promise.resolve(to)
                return to
            })

            return {
                setTo,
                asyncSetTo
            }
        })
    const ComputedFactory = types
        .model({
            width: 100,
            height: 200
        })
        .views(self => ({
            get area() {
                return self.width * self.height
            }
        }))
    const ComputedFactory2 = types
        .model({
            props: types.map(types.number)
        })
        .views(self => ({
            get area() {
                return self.props.get("width")! * self.props.get("height")!
            }
        }))
        .actions(self => {
            function setWidth(value) {
                self.props.set("width", value)
            }
            function setHeight(value) {
                self.props.set("height", value)
            }
            return {
                setWidth,
                setHeight
            }
        })
    const BoxFactory = types.model({
        width: 0,
        height: 0
    })
    const ColorFactory = types.model({
        color: "#FFFFFF"
    })
    return { Factory, ComputedFactory, ComputedFactory2, BoxFactory, ColorFactory }
}
// === FACTORY TESTS ===
test("it should create a factory", () => {
    const { Factory } = createTestFactories()
    const instance = Factory.create()
    const snapshot = getSnapshot(instance)
    expect(snapshot).toEqual({ to: "world" })
    expect(Factory.create().toJSON!()).toEqual({ to: "world" }) // toJSON is there as shortcut for getSnapshot(), primarily for debugging convenience
    expect(Factory.create().toString()).toEqual("AnonymousModel@<root>")
})
test("it should restore the state from the snapshot", () => {
    const { Factory } = createTestFactories()
    expect(getSnapshot(Factory.create({ to: "universe" }))).toEqual({ to: "universe" })
})
// === SNAPSHOT TESTS ===
test("it should emit snapshots", () => {
    const { Factory } = createTestFactories()
    const doc = Factory.create()
    unprotect(doc)
    let snapshots: any[] = []
    onSnapshot(doc, snapshot => snapshots.push(snapshot))
    doc.to = "universe"
    expect(snapshots).toEqual([{ to: "universe" }])
})
test("it should apply snapshots", () => {
    const { Factory } = createTestFactories()
    const doc = Factory.create()
    applySnapshot(doc, { to: "universe" })
    expect(getSnapshot(doc)).toEqual({ to: "universe" })
})
test("it should apply and accept null value for types.maybe(complexType)", () => {
    const Item = types.model({
        value: types.string
    })
    const Model = types.model({
        item: types.maybe(Item)
    })
    const myModel = Model.create()
    applySnapshot(myModel, { item: { value: "something" } })
    applySnapshot(myModel, { item: null })
    expect(getSnapshot(myModel)).toEqual({ item: null })
})
test("it should return a snapshot", () => {
    const { Factory } = createTestFactories()
    const doc = Factory.create()
    expect(getSnapshot(doc)).toEqual({ to: "world" })
})
// === PATCHES TESTS ===
test("it should emit patches", () => {
    const { Factory } = createTestFactories()
    const doc = Factory.create()
    unprotect(doc)
    let patches: any[] = []
    onPatch(doc, patch => patches.push(patch))
    doc.to = "universe"
    expect(patches).toEqual([{ op: "replace", path: "/to", value: "universe" }])
})
test("it should apply a patch", () => {
    const { Factory } = createTestFactories()
    const doc = Factory.create()
    applyPatch(doc, { op: "replace", path: "/to", value: "universe" })
    expect(getSnapshot(doc)).toEqual({ to: "universe" })
})
test("it should apply patches", () => {
    const { Factory } = createTestFactories()
    const doc = Factory.create()
    applyPatch(doc, [
        { op: "replace", path: "/to", value: "mars" },
        { op: "replace", path: "/to", value: "universe" }
    ])
    expect(getSnapshot(doc)).toEqual({ to: "universe" })
})
test("it should stop listening to patches patches", () => {
    const { Factory } = createTestFactories()
    const doc = Factory.create()
    unprotect(doc)
    let patches: any[] = []
    let disposer = onPatch(doc, patch => patches.push(patch))
    doc.to = "universe"
    disposer()
    doc.to = "mweststrate"
    expect(patches).toEqual([{ op: "replace", path: "/to", value: "universe" }])
})
// === ACTIONS TESTS ===
test("it should call actions correctly", () => {
    const { Factory } = createTestFactories()
    const doc = Factory.create()
    doc.setTo("universe")
    expect(getSnapshot(doc)).toEqual({ to: "universe" })
})
test("it should emit action calls", () => {
    const { Factory } = createTestFactories()
    const doc = Factory.create()
    let actions: any[] = []
    onAction(doc, action => actions.push(action))
    doc.setTo("universe")
    expect(actions).toEqual([{ name: "setTo", path: "", args: ["universe"] }])
})
test("it should apply action call", () => {
    const { Factory } = createTestFactories()
    const doc = Factory.create()
    applyAction(doc, { name: "setTo", path: "", args: ["universe"] })
    expect(getSnapshot(doc)).toEqual({ to: "universe" })
})
test("it should apply actions calls", () => {
    const { Factory } = createTestFactories()
    const doc = Factory.create()
    applyAction(doc, [
        { name: "setTo", path: "", args: ["mars"] },
        { name: "setTo", path: "", args: ["universe"] }
    ])
    expect(getSnapshot(doc)).toEqual({ to: "universe" })
})
test("it should change value in sync action after promise then", async () => {
    const { Factory } = createTestFactories()
    const doc = Factory.create()
    await applyAction(doc, { name: "setTo", path: "", args: ["mars"] }).then(val => {
        doc.setTo(val[0] + " universe")
    })
    expect(getSnapshot(doc)).toEqual({ to: "mars universe" })
})
test("it should change value in async action after promise then", async () => {
    const { Factory } = createTestFactories()
    const doc = Factory.create()
    await applyAction(doc, { name: "asyncSetTo", path: "", args: ["mars"] }).then(val => {
        doc.setTo(val[0] + " universe")
    })
    expect(getSnapshot(doc)).toEqual({ to: "mars universe" })
})
// === COMPUTED VALUES ===
test("it should have computed properties", () => {
    const { ComputedFactory } = createTestFactories()
    const doc = ComputedFactory.create()
    unprotect(doc)
    doc.width = 3
    doc.height = 2
    expect(doc.area).toEqual(6)
})

test("it should throw if a replaced object is read or written to", () => {
    const Todo = types
        .model("Todo", {
            title: "test"
        })
        .actions(self => {
            function fn() {}
            return {
                fn
            }
        })
    const Store = types.model("Store", {
        todo: Todo
    })
    const s = Store.create({
        todo: { title: "3" }
    })
    unprotect(s)
    const todo = s.todo
    s.todo = Todo.create({ title: "4" })
    expect(s.todo.title).toBe("4")

    // try reading old todo
    const err =
        "[mobx-state-tree] You are trying to read or write to an object that is no longer part of a state tree. (Object type was 'Todo')."
    expect(() => {
        todo.fn()
    }).toThrowError(err)
    expect(() => {
        todo.title
    }).toThrowError(err)
    expect(() => {
        todo.title = "5"
    }).toThrowError(err)
})

// === COMPOSE FACTORY ===
test("it should compose factories", () => {
    const { BoxFactory, ColorFactory } = createTestFactories()
    const ComposedFactory = types.compose(BoxFactory, ColorFactory)
    expect(getSnapshot(ComposedFactory.create())).toEqual({ width: 0, height: 0, color: "#FFFFFF" })
})
test("it should compose factories with computed properties", () => {
    const { ComputedFactory2, ColorFactory } = createTestFactories()
    const ComposedFactory = types.compose(ColorFactory, ComputedFactory2)
    const store = ComposedFactory.create({ props: { width: 100, height: 200 } })
    expect(getSnapshot(store)).toEqual({ props: { width: 100, height: 200 }, color: "#FFFFFF" })
    expect(store.area).toBe(20000)
    expect(typeof store.setWidth).toBe("function")
    expect(typeof store.setHeight).toBe("function")
})
test("it should compose multiple types with computed properties", () => {
    const { ComputedFactory2, ColorFactory } = createTestFactories()
    const ComposedFactory = types.compose(ColorFactory, ComputedFactory2)
    const store = ComposedFactory.create({ props: { width: 100, height: 200 } })
    expect(getSnapshot(store)).toEqual({ props: { width: 100, height: 200 }, color: "#FFFFFF" })
    expect(store.area).toBe(20000)
    expect(typeof store.setWidth).toBe("function")
    expect(typeof store.setHeight).toBe("function")
})
test("methods get overridden by compose", () => {
    const A = types
        .model({
            count: types.optional(types.number, 0)
        })
        .actions(self => {
            function increment() {
                self.count += 1
            }
            return {
                increment
            }
        })
    const B = A.actions(self => ({
        increment() {
            self.count += 10
        }
    }))
    const store = B.create()
    expect(getSnapshot(store)).toEqual({ count: 0 })
    expect(store.count).toBe(0)
    store.increment()
    expect(store.count).toBe(10)
})
test("compose should add new props", () => {
    const A = types.model({
        count: types.optional(types.number, 0)
    })
    const B = A.props({
        called: types.optional(types.number, 0)
    })
    const store = B.create()
    expect(getSnapshot(store)).toEqual({ count: 0, called: 0 })
    expect(store.count).toBe(0)
})
test("models should expose their actions to be used in a composable way", () => {
    const A = types
        .model({
            count: types.optional(types.number, 0)
        })
        .actions(self => {
            function increment() {
                self.count += 1
            }
            return {
                increment
            }
        })
    const B = A.props({
        called: types.optional(types.number, 0)
    }).actions(self => {
        const baseIncrement = self.increment
        return {
            increment() {
                baseIncrement()
                self.called += 1
            }
        }
    })
    const store = B.create()
    expect(getSnapshot(store)).toEqual({ count: 0, called: 0 })
    expect(store.count).toBe(0)
    store.increment()
    expect(store.count).toBe(1)
    expect(store.called).toBe(1)
})
test("compose should be overwrite", () => {
    const A = types
        .model({
            name: "",
            alias: ""
        })
        .views(self => ({
            get displayName() {
                return self.alias || self.name
            }
        }))
    const B = A.props({
        type: ""
    }).views(self => ({
        get displayName() {
            return self.alias || self.name + self.type
        }
    }))
    const storeA = A.create({ name: "nameA", alias: "aliasA" })
    const storeB = B.create({ name: "nameB", alias: "aliasB", type: "typeB" })
    const storeC = B.create({ name: "nameC", type: "typeC" })
    expect(storeA.displayName).toBe("aliasA")
    expect(storeB.displayName).toBe("aliasB")
    expect(storeC.displayName).toBe("nameCtypeC")
})
// === TYPE CHECKS ===
test("it should check the type correctly", () => {
    const { Factory } = createTestFactories()
    const doc = Factory.create()
    expect(Factory.is(doc)).toEqual(true)
    expect(Factory.is([])).toEqual(false)
    expect(Factory.is({})).toEqual(true)
    expect(Factory.is({ to: "mars" })).toEqual(true)
    expect(Factory.is({ wrongKey: true })).toEqual(true)
    expect(Factory.is({ to: 3 })).toEqual(false)
})
if (global.process.env.NODE_ENV !== "production") {
    test("it should require complex fields to be present", () => {
        expect(
            types
                .model({
                    todo: types.model({})
                })
                .is({})
        ).toBe(false)
        expect(() =>
            types
                .model({
                    todo: types.model({})
                })
                .create()
        ).toThrow()
        expect(
            types
                .model({
                    todo: types.array(types.string)
                })
                .is({})
        ).toBe(false) // TBD: or true?
        expect(() =>
            types
                .model({
                    todo: types.array(types.string)
                })
                .create()
        ).toThrow()
        expect(
            types
                .model({
                    todo: types.map(types.string)
                })
                .is({})
        ).toBe(false)
        expect(() =>
            types
                .model({
                    todo: types.map(types.string)
                })
                .create()
        ).toThrow()
    })
}
// === VIEW FUNCTIONS ===
test("view functions should be tracked", () => {
    const model = types
        .model({
            x: 3
        })
        .views(self => ({
            doubler() {
                return self.x * 2
            }
        }))
        .create()
    unprotect(model)
    const values: any[] = []
    const d = autorun(() => {
        values.push(model.doubler())
    })
    model.x = 7
    expect(values).toEqual([6, 14])
})
test("view functions should not be allowed to change state", () => {
    const model = types
        .model({
            x: 3
        })
        .views(self => ({
            doubler() {
                self.x *= 2
            }
        }))
        .actions(self => {
            function anotherDoubler() {
                self.x *= 2
            }
            return {
                anotherDoubler
            }
        })
        .create()
    expect(() => model.doubler()).toThrow()
    model.anotherDoubler()
    expect(model.x).toBe(6)
})
test("it should consider primitives as proposed defaults", () => {
    const now = new Date()
    const Todo = types.model({
        id: 0,
        name: "Hello world",
        done: false,
        createdAt: now
    })
    const doc = Todo.create()
    expect(getSnapshot(doc)).toEqual({
        id: 0,
        name: "Hello world",
        done: false,
        createdAt: now.getTime()
    })
})
test("it should throw if a non-primitive value is provided and no default can be created", () => {
    expect(() => {
        const Todo = types.model({
            complex: {
                a: 1,
                b: 2
            }
        })
    }).toThrow()
})
if (global.process.env.NODE_ENV !== "production") {
    test("it should not be possible to remove a node from a parent if it is required, see ", () => {
        const A = types.model("A", { x: 3 })
        const B = types.model("B", { a: A })
        const b = B.create({ a: { x: 7 } })
        unprotect(b)
        expect(() => {
            detach(b.a)
        }).toThrowError(/Error while converting `null` to `A`/)
        expect(() => {
            destroy(b.a)
        }).toThrowError(/Error while converting `null` to `A`/)
    })
}
test("it should be possible to share states between views and actions using enhance", () => {
    const A = types.model({}).extend(self => {
        const localState = observable.box(3)
        return {
            views: {
                get x() {
                    return localState.get()
                }
            },
            actions: {
                setX(value) {
                    localState.set(value)
                }
            }
        }
    })
    let x = 0
    let a = A.create()
    const d = reaction(
        () => a.x,
        v => {
            x = v
        }
    )
    a.setX(7)
    expect(a.x).toBe(7)
    expect(x).toBe(7)
    d()
})
test("It should throw if any other key is returned from extend", () => {
    const A = types.model({}).extend(() => ({ stuff() {} } as any)) // TODO: fix typing
    expect(() => A.create()).toThrowError(/stuff/)
})

test("782, TS + compose", () => {
    const User = types.model("User", {
        id: types.identifier(types.string),
        name: types.maybe(types.string),
        avatar: types.maybe(types.string)
    })

    const user = User.create({ id: "someId" })
})
