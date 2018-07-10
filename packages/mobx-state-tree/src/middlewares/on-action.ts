import { runInAction } from "mobx"

import {
    INode,
    getStateTreeNode,
    IStateTreeNode,
    isStateTreeNode,
    addMiddleware,
    IMiddlewareEvent,
    tryResolve,
    applyPatch,
    getType,
    applySnapshot,
    isRoot,
    isProtected,
    fail,
    isPlainObject,
    isPrimitive,
    IDisposer,
    isArray,
    asArray,
    getRelativePathBetweenNodes
} from "../internal"

export type ISerializedActionCall = {
    name: string
    path?: string
    args?: any[]
}

export interface IActionRecorder {
    actions: ReadonlyArray<ISerializedActionCall>
    stop(): any
    replay(target: IStateTreeNode): Promise<any[]>
}

function serializeArgument(node: INode, actionName: string, index: number, arg: any): any {
    if (arg instanceof Date) return { $MST_DATE: arg.getTime() }
    if (isPrimitive(arg)) return arg
    // We should not serialize MST nodes, even if we can, because we don't know if the receiving party can handle a raw snapshot instead of an
    // MST type instance. So if one wants to serialize a MST node that was pass in, either explitly pass: 1: an id, 2: a (relative) path, 3: a snapshot
    if (isStateTreeNode(arg)) return serializeTheUnserializable(`[MSTNode: ${getType(arg).name}]`)
    if (typeof arg === "function") return serializeTheUnserializable(`[function]`)
    if (typeof arg === "object" && !isPlainObject(arg) && !isArray(arg))
        return serializeTheUnserializable(
            `[object ${(arg && arg.constructor && arg.constructor.name) || "Complex Object"}]`
        )
    try {
        // Check if serializable, cycle free etc...
        // MWE: there must be a better way....
        JSON.stringify(arg) // or throws
        return arg
    } catch (e) {
        return serializeTheUnserializable("" + e)
    }
}

function deserializeArgument(adm: INode, value: any): any {
    if (value && typeof value === "object" && "$MST_DATE" in value)
        return new Date(value["$MST_DATE"])
    return value
}

function serializeTheUnserializable(baseType: string) {
    return {
        $MST_UNSERIALIZABLE: true,
        type: baseType
    }
}

/**
 * Applies an action or a series of actions in a single MobX transaction.
 * Does not return any value
 * Takes an action description as produced by the `onAction` middleware.
 *
 * @export
 * @param {Object} target
 * @param {IActionCall[]} actions
 * @param {IActionCallOptions} [options]
 */
export function applyAction(
    target: IStateTreeNode,
    actions: ISerializedActionCall | ISerializedActionCall[]
): Promise<any[]> {
    // check all arguments
    if (process.env.NODE_ENV !== "production") {
        if (!isStateTreeNode(target))
            fail("expected first argument to be a mobx-state-tree node, got " + target + " instead")
        if (typeof actions !== "object")
            fail("expected second argument to be an object or array, got " + actions + " instead")
    }

    return new Promise((res, rej) => {
        runInAction(() => {
            Promise.all(
                asArray(actions).map(action => {
                    let result = null
                    try {
                        result = baseApplyAction(target, action)
                    } catch (err) {
                        Promise.reject(err)
                        fail(`Action ${action} excuted failed in ${target}`)
                    }
                    return result instanceof Promise ? result : Promise.resolve(result)
                })
            )
                .then((val: Promise<any>[]) => res(val))
                .catch(({ err, target, action }) => {
                    rej(err)
                })
        })
    })
}

function baseApplyAction(target: IStateTreeNode, action: ISerializedActionCall): any {
    const resolvedTarget = tryResolve(target, action.path || "")
    if (!resolvedTarget) return fail(`Invalid action path: ${action.path || ""}`)
    const node = getStateTreeNode(resolvedTarget)

    // Reserved functions
    if (action.name === "@APPLY_PATCHES") {
        return applyPatch.call(null, resolvedTarget, action.args![0])
    }
    if (action.name === "@APPLY_SNAPSHOT") {
        return applySnapshot.call(null, resolvedTarget, action.args![0])
    }

    if (!(typeof resolvedTarget[action.name] === "function"))
        fail(`Action '${action.name}' does not exist in '${node.path}'`)
    return resolvedTarget[action.name].apply(
        resolvedTarget,
        action.args ? action.args.map(v => deserializeArgument(node, v)) : []
    )
}

/**
 * Small abstraction around `onAction` and `applyAction`, attaches an action listener to a tree and records all the actions emitted.
 * Returns an recorder object with the following signature:
 *
 * @example
 * export interface IActionRecorder {
 *      // the recorded actions
 *      actions: ISerializedActionCall[]
 *      // stop recording actions
 *      stop(): any
 *      // apply all the recorded actions on the given object
 *      replay(target: IStateTreeNode): Promise<any[]>
 * }
 *
 * @export
 * @param {IStateTreeNode} subject
 * @returns {IPatchRecorder}
 */
export function recordActions(subject: IStateTreeNode): IActionRecorder {
    // check all arguments
    if (process.env.NODE_ENV !== "production") {
        if (!isStateTreeNode(subject))
            fail(
                "expected first argument to be a mobx-state-tree node, got " + subject + " instead"
            )
    }
    let recorder = {
        actions: [] as ISerializedActionCall[],
        stop: () => disposer(),
        replay: (target: IStateTreeNode) => {
            return applyAction(target, recorder.actions)
        }
    }
    let disposer = onAction(subject, recorder.actions.push.bind(recorder.actions))
    return recorder
}

/**
 * Registers a function that will be invoked for each action that is called on the provided model instance, or to any of its children.
 * See [actions](https://github.com/mobxjs/mobx-state-tree#actions) for more details. onAction events are emitted only for the outermost called action in the stack.
 * Action can also be intercepted by middleware using addMiddleware to change the function call before it will be run.
 *
 * Not all action arguments might be serializable. For unserializable arguments, a struct like `{ $MST_UNSERIALIZABLE: true, type: "someType" }` will be generated.
 * MST Nodes are considered non-serializable as well (they could be serialized as there snapshot, but it is uncertain whether an replaying party will be able to handle such a non-instantiated snapshot).
 * Rather, when using `onAction` middleware, one should consider in passing arguments which are 1: an id, 2: a (relative) path, or 3: a snapshot. Instead of a real MST node.
 *
 * @example
 * const Todo = types.model({
 *   task: types.string
 * })
 *
 * const TodoStore = types.model({
 *   todos: types.array(Todo)
 * }).actions(self => ({
 *   add(todo) {
 *     self.todos.push(todo);
 *   }
 * }))
 *
 * const s = TodoStore.create({ todos: [] })
 *
 * let disposer = onAction(s, (call) => {
 *   console.log(call);
 * })
 *
 * s.add({ task: "Grab a coffee" })
 * // Logs: { name: "add", path: "", args: [{ task: "Grab a coffee" }] }
 *
 * @export
 * @param {IStateTreeNode} target
 * @param {(call: ISerializedActionCall) => void} listener
 * @param attachAfter {boolean} (default false) fires the listener *after* the action has executed instead of before.
 * @returns {IDisposer}
 */
export function onAction(
    target: IStateTreeNode,
    listener: (call: ISerializedActionCall) => void,
    attachAfter = false
): IDisposer {
    // check all arguments
    if (process.env.NODE_ENV !== "production") {
        if (!isStateTreeNode(target))
            fail("expected first argument to be a mobx-state-tree node, got " + target + " instead")
        if (!isRoot(target))
            console.warn(
                "[mobx-state-tree] Warning: Attaching onAction listeners to non root nodes is dangerous: No events will be emitted for actions initiated higher up in the tree."
            )
        if (!isProtected(target))
            console.warn(
                "[mobx-state-tree] Warning: Attaching onAction listeners to non protected nodes is dangerous: No events will be emitted for direct modifications without action."
            )
    }

    function fireListener(rawCall: IMiddlewareEvent) {
        if (rawCall.type === "action" && rawCall.id === rawCall.rootId) {
            const sourceNode = getStateTreeNode(rawCall.context)
            listener({
                name: rawCall.name,
                path: getRelativePathBetweenNodes(getStateTreeNode(target), sourceNode),
                args: rawCall.args.map((arg: any, index: number) =>
                    serializeArgument(sourceNode, rawCall.name, index, arg)
                )
            })
        }
    }

    return addMiddleware(
        target,
        attachAfter
            ? function onActionMiddleware(rawCall, next) {
                  const res = next(rawCall)
                  fireListener(rawCall)
                  return res
              }
            : function onActionMiddleware(rawCall, next) {
                  fireListener(rawCall)
                  return next(rawCall)
              }
    )
}
