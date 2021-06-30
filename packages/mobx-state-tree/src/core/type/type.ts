import { action } from "mobx"

import {
    fail,
    isMutable,
    isStateTreeNode,
    getStateTreeNode,
    IValidationContext,
    IValidationResult,
    typecheckInternal,
    typeCheckFailure,
    typeCheckSuccess,
    IStateTreeNode,
    IJsonPatch,
    getType,
    ObjectNode,
    IChildNodesMap,
    ModelPrimitive,
    normalizeIdentifier,
    AnyObjectNode,
    AnyNode,
    BaseNode,
    ScalarNode,
    getStateTreeNodeSafe,
    assertArg
} from "../../internal"

/**
 * @internal
 * @hidden
 */
export enum TypeFlags {
    String = 1,
    Number = 1 << 1,
    Boolean = 1 << 2,
    Date = 1 << 3,
    Literal = 1 << 4,
    Array = 1 << 5,
    Map = 1 << 6,
    Object = 1 << 7,
    Frozen = 1 << 8,
    Optional = 1 << 9,
    Reference = 1 << 10,
    Identifier = 1 << 11,
    Late = 1 << 12,
    Refinement = 1 << 13,
    Union = 1 << 14,
    Null = 1 << 15,
    Undefined = 1 << 16,
    Integer = 1 << 17,
    Custom = 1 << 18,
    SnapshotProcessor = 1 << 19,
    Lazy = 1 << 20
}

/**
 * @internal
 * @hidden
 */
export const cannotDetermineSubtype = "cannotDetermine"

/**
 * A state tree node value.
 * @hidden
 */
export type STNValue<T, IT extends IAnyType> = T extends object ? T & IStateTreeNode<IT> : T

/** @hidden */
const $type: unique symbol = Symbol("$type")

/**
 * A type, either complex or simple.
 */
export interface IType<C, S, T> {
    // fake, will never be present, just for typing
    /** @hidden */
    readonly [$type]: undefined

    /**
     * Friendly type name.
     */
    name: string

    /**
     * Name of the identifier attribute or null if none.
     */
    readonly identifierAttribute?: string

    /**
     * Creates an instance for the type given an snapshot input.
     *
     * @returns An instance of that type.
     */
    create(snapshot?: C, env?: any): this["Type"]

    /**
     * Checks if a given snapshot / instance is of the given type.
     *
     * @param thing Snapshot or instance to be checked.
     * @returns true if the value is of the current type, false otherwise.
     */
    is(thing: any): thing is C | this["Type"]

    /**
     * Run's the type's typechecker on the given value with the given validation context.
     *
     * @param thing Value to be checked, either a snapshot or an instance.
     * @param context Validation context, an array of { subpaths, subtypes } that should be validated
     * @returns The validation result, an array with the list of validation errors.
     */
    validate(thing: C, context: IValidationContext): IValidationResult

    /**
     * Gets the textual representation of the type as a string.
     */
    describe(): string

    /**
     * @deprecated use `Instance<typeof MyType>` instead.
     * @hidden
     */
    readonly Type: STNValue<T, this>

    /**
     * @deprecated do not use.
     * @hidden
     */
    readonly TypeWithoutSTN: T

    /**
     * @deprecated use `SnapshotOut<typeof MyType>` instead.
     * @hidden
     */
    readonly SnapshotType: S

    /**
     * @deprecated use `SnapshotIn<typeof MyType>` instead.
     * @hidden
     */
    readonly CreationType: C

    // Internal api's

    /**
     * @internal
     * @hidden
     */
    flags: TypeFlags
    /**
     * @internal
     * @hidden
     */
    isType: true
    /**
     * @internal
     * @hidden
     */
    instantiate(
        parent: AnyObjectNode | null,
        subpath: string,
        environment: any,
        initialValue: C | T
    ): BaseNode<C, S, T>
    /**
     * @internal
     * @hidden
     */
    reconcile(
        current: BaseNode<C, S, T>,
        newValue: C | T,
        parent: AnyObjectNode,
        subpath: string
    ): BaseNode<C, S, T>
    /**
     * @internal
     * @hidden
     */
    getSnapshot(node: BaseNode<C, S, T>, applyPostProcess?: boolean): S
    /**
     * @internal
     * @hidden
     */
    isAssignableFrom(type: IAnyType): boolean
    /**
     * @internal
     * @hidden
     */
    getSubTypes(): IAnyType[] | IAnyType | null | typeof cannotDetermineSubtype
}

/**
 * Any kind of type.
 */
export interface IAnyType extends IType<any, any, any> {}

/**
 * A simple type, this is, a type where the instance and the snapshot representation are the same.
 */
export interface ISimpleType<T> extends IType<T, T, T> {}

/** @hidden */
export type Primitives = ModelPrimitive | null | undefined

/**
 * A complex type.
 * @deprecated just for compatibility with old versions, could be deprecated on the next major version
 * @hidden
 */
export interface IComplexType<C, S, T> extends IType<C, S, T & object> {}

/**
 * Any kind of complex type.
 */
export interface IAnyComplexType extends IType<any, any, object> {}

/** @hidden */
export type ExtractCSTWithoutSTN<
    IT extends { [$type]: undefined; CreationType: any; SnapshotType: any; TypeWithoutSTN: any }
> = IT["CreationType"] | IT["SnapshotType"] | IT["TypeWithoutSTN"]
/** @hidden */
export type ExtractCSTWithSTN<
    IT extends { [$type]: undefined; CreationType: any; SnapshotType: any; Type: any }
> = IT["CreationType"] | IT["SnapshotType"] | IT["Type"]

/**
 * The instance representation of a given type.
 */
export type Instance<T> = T extends { [$type]: undefined; Type: any } ? T["Type"] : T

/**
 * The input (creation) snapshot representation of a given type.
 */
export type SnapshotIn<T> = T extends { [$type]: undefined; CreationType: any }
    ? T["CreationType"]
    : T extends IStateTreeNode<infer IT>
    ? IT["CreationType"]
    : T

/**
 * The output snapshot representation of a given type.
 */
export type SnapshotOut<T> = T extends { [$type]: undefined; SnapshotType: any }
    ? T["SnapshotType"]
    : T extends IStateTreeNode<infer IT>
    ? IT["SnapshotType"]
    : T

/**
 * A type which is equivalent to the union of SnapshotIn and Instance types of a given typeof TYPE or typeof VARIABLE.
 * For primitives it defaults to the primitive itself.
 *
 * For example:
 * - `SnapshotOrInstance<typeof ModelA> = SnapshotIn<typeof ModelA> | Instance<typeof ModelA>`
 * - `SnapshotOrInstance<typeof self.a (where self.a is a ModelA)> = SnapshotIn<typeof ModelA> | Instance<typeof ModelA>`
 *
 * Usually you might want to use this when your model has a setter action that sets a property.
 *
 * Example:
 * ```ts
 * const ModelA = types.model({
 *   n: types.number
 * })
 *
 * const ModelB = types.model({
 *   innerModel: ModelA
 * }).actions(self => ({
 *   // this will accept as property both the snapshot and the instance, whichever is preferred
 *   setInnerModel(m: SnapshotOrInstance<typeof self.innerModel>) {
 *     self.innerModel = cast(m)
 *   }
 * }))
 * ```
 */
export type SnapshotOrInstance<T> = SnapshotIn<T> | Instance<T>

/**
 * A base type produces a MST node (Node in the state tree)
 *
 * @internal
 * @hidden
 */
export abstract class BaseType<C, S, T, N extends BaseNode<any, any, any> = BaseNode<C, S, T>>
    implements IType<C, S, T> {
    [$type]!: undefined

    // these are just to make inner types avaialable to inherited classes
    readonly C!: C
    readonly S!: S
    readonly T!: T
    readonly N!: N

    readonly isType = true
    readonly name: string

    constructor(name: string) {
        this.name = name
    }

    create(snapshot?: C, environment?: any) {
        typecheckInternal(this, snapshot)
        return this.instantiate(null, "", environment, snapshot!).value
    }

    getSnapshot(node: N, applyPostProcess?: boolean): S {
        // istanbul ignore next
        throw fail("unimplemented method")
    }

    abstract reconcile(current: N, newValue: C | T, parent: AnyObjectNode, subpath: string): N

    abstract instantiate(
        parent: AnyObjectNode | null,
        subpath: string,
        environment: any,
        initialValue: C | T
    ): N

    declare abstract flags: TypeFlags
    abstract describe(): string

    abstract isValidSnapshot(value: C, context: IValidationContext): IValidationResult

    isAssignableFrom(type: IAnyType): boolean {
        return type === this
    }

    validate(value: C | T, context: IValidationContext): IValidationResult {
        const node = getStateTreeNodeSafe(value)
        if (node) {
            const valueType = getType(value)
            return this.isAssignableFrom(valueType)
                ? typeCheckSuccess()
                : typeCheckFailure(context, value)
            // it is tempting to compare snapshots, but in that case we should always clone on assignments...
        }
        return this.isValidSnapshot(value as C, context)
    }

    is(thing: any): thing is any {
        return this.validate(thing, [{ path: "", type: this }]).length === 0
    }

    get Type(): any {
        // istanbul ignore next
        throw fail(
            "Factory.Type should not be actually called. It is just a Type signature that can be used at compile time with Typescript, by using `typeof type.Type`"
        )
    }
    get TypeWithoutSTN(): any {
        // istanbul ignore next
        throw fail(
            "Factory.TypeWithoutSTN should not be actually called. It is just a Type signature that can be used at compile time with Typescript, by using `typeof type.TypeWithoutSTN`"
        )
    }
    get SnapshotType(): any {
        // istanbul ignore next
        throw fail(
            "Factory.SnapshotType should not be actually called. It is just a Type signature that can be used at compile time with Typescript, by using `typeof type.SnapshotType`"
        )
    }
    get CreationType(): any {
        // istanbul ignore next
        throw fail(
            "Factory.CreationType should not be actually called. It is just a Type signature that can be used at compile time with Typescript, by using `typeof type.CreationType`"
        )
    }

    abstract getSubTypes(): IAnyType[] | IAnyType | null | typeof cannotDetermineSubtype
}
BaseType.prototype.create = action(BaseType.prototype.create)

/**
 * @internal
 * @hidden
 */
export type AnyBaseType = BaseType<any, any, any, any>

/**
 * @internal
 * @hidden
 */
export type ExtractNodeType<IT extends IAnyType> = IT extends BaseType<any, any, any, infer N>
    ? N
    : never

/**
 * A complex type produces a MST node (Node in the state tree)
 *
 * @internal
 * @hidden
 */
export abstract class ComplexType<C, S, T> extends BaseType<C, S, T, ObjectNode<C, S, T>> {
    identifierAttribute?: string

    constructor(name: string) {
        super(name)
    }

    create(snapshot: C = this.getDefaultSnapshot(), environment?: any) {
        return super.create(snapshot, environment)
    }

    getValue(node: this["N"]): T {
        node.createObservableInstanceIfNeeded()
        return node.storedValue
    }

    abstract getDefaultSnapshot(): C

    abstract createNewInstance(childNodes: IChildNodesMap): T
    abstract finalizeNewInstance(node: this["N"], instance: any): void

    abstract applySnapshot(node: this["N"], snapshot: C): void
    abstract applyPatchLocally(node: this["N"], subpath: string, patch: IJsonPatch): void
    abstract processInitialSnapshot(childNodes: IChildNodesMap, snapshot: C): S

    abstract getChildren(node: this["N"]): ReadonlyArray<AnyNode>
    abstract getChildNode(node: this["N"], key: string): AnyNode
    abstract getChildType(propertyName?: string): IAnyType
    abstract initializeChildNodes(node: this["N"], snapshot: any): IChildNodesMap
    abstract removeChild(node: this["N"], subpath: string): void

    private tryToReconcileNode(current: this["N"], newValue: C | T) {
        if (current.isDetaching) return false
        if ((current.snapshot as any) === newValue) {
            // newValue is the current snapshot of the node, noop
            return true
        }
        if (isStateTreeNode(newValue) && getStateTreeNode(newValue) === current) {
            // the current node is the same as the new one
            return true
        }
        if (
            current.type === this &&
            isMutable(newValue) &&
            !isStateTreeNode(newValue) &&
            (!current.identifierAttribute ||
                current.identifier ===
                    normalizeIdentifier((newValue as any)[current.identifierAttribute]))
        ) {
            // the newValue has no node, so can be treated like a snapshot
            // we can reconcile
            current.applySnapshot(newValue as C)
            return true
        }
        return false
    }

    reconcile(
        current: this["N"],
        newValue: C | T,
        parent: AnyObjectNode,
        subpath: string
    ): this["N"] {
        const nodeReconciled = this.tryToReconcileNode(current, newValue)
        if (nodeReconciled) {
            current.setParent(parent, subpath)
            return current
        }

        // current node cannot be recycled in any way
        current.die() // noop if detaching
        // attempt to reuse the new one
        if (isStateTreeNode(newValue) && this.isAssignableFrom(getType(newValue))) {
            // newValue is a Node as well, move it here..
            const newNode = getStateTreeNode(newValue)
            newNode.setParent(parent, subpath)
            return newNode
        }
        // nothing to do, we have to create a new node
        return this.instantiate(parent, subpath, undefined, newValue)
    }

    getSubTypes() {
        return null
    }
}
ComplexType.prototype.create = action(ComplexType.prototype.create)

/**
 * @internal
 * @hidden
 */
export abstract class SimpleType<C, S, T> extends BaseType<C, S, T, ScalarNode<C, S, T>> {
    abstract instantiate(
        parent: AnyObjectNode | null,
        subpath: string,
        environment: any,
        initialValue: C
    ): this["N"]

    createNewInstance(snapshot: C): T {
        return snapshot as any
    }

    getValue(node: this["N"]): T {
        // if we ever find a case where scalar nodes can be accessed without iterating through its parent
        // uncomment this to make sure the parent chain is created when this is accessed
        // if (node.parent) {
        //     node.parent.createObservableInstanceIfNeeded()
        // }
        return node.storedValue
    }

    getSnapshot(node: this["N"]): S {
        return node.storedValue
    }

    reconcile(current: this["N"], newValue: C, parent: AnyObjectNode, subpath: string): this["N"] {
        // reconcile only if type and value are still the same, and only if the node is not detaching
        if (!current.isDetaching && current.type === this && current.storedValue === newValue) {
            return current
        }
        const res = this.instantiate(parent, subpath, undefined, newValue)
        current.die() // noop if detaching
        return res
    }

    getSubTypes() {
        return null
    }
}

/**
 * Returns if a given value represents a type.
 *
 * @param value Value to check.
 * @returns `true` if the value is a type.
 */
export function isType(value: any): value is IAnyType {
    return typeof value === "object" && value && value.isType === true
}

/**
 * @internal
 * @hidden
 */
export function assertIsType(type: IAnyType, argNumber: number | number[]) {
    assertArg(type, isType, "mobx-state-tree type", argNumber)
}
