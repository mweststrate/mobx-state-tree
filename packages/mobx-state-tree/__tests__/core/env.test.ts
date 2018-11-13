import { types, getEnv, clone, detach, unprotect, hasEnv } from "../../src"

const Todo = types
    .model({
        title: "test"
    })
    .views(self => ({
        get description() {
            return getEnv(self).useUppercase ? self.title.toUpperCase() : self.title
        }
    }))
const Store = types.model({
    todos: types.array(Todo)
})
function createEnvironment() {
    return {
        useUppercase: true
    }
}
test("it should be possible to use environments", () => {
    const env = createEnvironment()
    const todo = Todo.create({}, env)
    expect(hasEnv(todo)).toBe(true)
    expect(todo.description).toBe("TEST")
    env.useUppercase = false
    expect(todo.description).toBe("test")
})
test("it should be possible to inherit environments", () => {
    const env = createEnvironment()
    const store = Store.create({ todos: [{}] }, env)
    expect(hasEnv(store.todos[0])).toBe(true)
    expect(store.todos[0].description).toBe("TEST")
    env.useUppercase = false
    expect(store.todos[0].description).toBe("test")
})
test("getEnv should throw error without environment", () => {
    const todo = Todo.create()
    expect(hasEnv(todo)).toBe(false)
    expect(() => getEnv(todo)).toThrowError(
        "Failed to find the environment of AnonymousModel@<root>"
    )
})
test("detach should preserve environment", () => {
    const env = createEnvironment()
    const store = Store.create({ todos: [{}] }, env)
    unprotect(store)
    const todo = detach(store.todos[0])
    expect(todo.description).toBe("TEST")
    env.useUppercase = false
    expect(todo.description).toBe("test")
})
test("it is possible to assign instance with the same environment as the parent to a tree", () => {
    const env = createEnvironment()
    const store = Store.create({ todos: [] }, env)
    const todo = Todo.create({}, env)
    unprotect(store)
    store.todos.push(todo)
    expect(store.todos.length === 1).toBe(true)
    expect(getEnv(store.todos) === getEnv(store.todos[0])).toBe(true)
    expect(getEnv(todo) === getEnv(store.todos[0])).toBe(true)
})
test("it is not possible to assign instance with a different environment than the parent to a tree", () => {
    if (process.env.NODE_ENV !== "production") {
        const env1 = createEnvironment()
        const env2 = createEnvironment()
        const store = Store.create({ todos: [] }, env1)
        const todo = Todo.create({}, env2)
        unprotect(store)
        expect(() => store.todos.push(todo)).toThrowError(
            "[mobx-state-tree] A state tree cannot be made part of another state tree as long as their environments are different."
        )
    }
})
test("it is possible to set a value inside a map of a map when using the same environment", () => {
    const env = createEnvironment()
    const EmptyModel = types.model({})
    const MapOfEmptyModel = types.model({
        map: types.map(EmptyModel)
    })
    const MapOfMapOfEmptyModel = types.model({
        map: types.map(MapOfEmptyModel)
    })
    const mapOfMap = MapOfMapOfEmptyModel.create(
        {
            map: {
                whatever: {
                    map: {}
                }
            }
        },
        env
    )
    unprotect(mapOfMap)
    // this should not throw
    mapOfMap.map.get("whatever")!.map.set("1234", EmptyModel.create({}, env))
    expect(getEnv(mapOfMap) === env).toBe(true)
    expect(getEnv(mapOfMap.map.get("whatever")!.map.get("1234")!) === env).toBe(true)
})
test("clone preserves environnment", () => {
    const env = createEnvironment()
    const store = Store.create({ todos: [{}] }, env)
    {
        const todo = clone(store.todos[0])
        expect(getEnv(todo) === env).toBe(true)
    }
    {
        const todo = clone(store.todos[0], true)
        expect(getEnv(todo) === env).toBe(true)
    }
    {
        const todo = clone(store.todos[0], false)
        expect(() => {
            getEnv(todo)
        }).toThrowError("Failed to find the environment of AnonymousModel@<root>")
    }
    {
        const env2 = createEnvironment()
        const todo = clone(store.todos[0], env2)
        expect(env2 === getEnv(todo)).toBe(true)
    }
})
