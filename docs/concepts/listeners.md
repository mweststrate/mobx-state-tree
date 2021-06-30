---
id: listeners
title: Listening to observables, snapshots, patches and actions
sidebar_label: Listening to changes
---

<div id="codefund"></div>

MST is powered by MobX. This means that it is immediately compatible with `observer` components or reactions like `autorun`:

```javascript
import { autorun } from "mobx"

autorun(() => {
    console.log(storeInstance.selectedTodo.title)
})
```

Because MST keeps immutable snapshots in the background, it is also possible to be notified when a new snapshot of the tree is available. This is similar to `.subscribe` on a redux store:

```javascript
onSnapshot(storeInstance, (newSnapshot) => {
    console.info("Got new snapshot:", newSnapshot)
})
```

However, sometimes it is more useful to precisely know what has changed rather than just receiving a complete new snapshot.
For that, MST supports json-patches out of the box.

```javascript
onPatch(storeInstance, patch => {
    console.info("Got change: ", patch)
})

storeInstance.todos[0].setTitle("Add milk")
// prints:
{
    path: "/todos/0",
    op: "replace",
    value: "Add milk"
}
```

Similarly, you can be notified whenever an action is invoked by using `onAction`.

```javascript
onAction(storeInstance, call => {
    console.info("Action was called:", call)
})

storeInstance.todos[0].setTitle("Add milk")
// prints:
{
    path: "/todos/0",
    name: "setTitle",
    args: ["Add milk"]
}
```

It is even possible to intercept actions before they are applied by adding middleware using `addMiddleware`:

```javascript
addMiddleware(storeInstance, (call, next) => {
    call.args[0] = call.args[0].replace(/tea/gi, "Coffee")
    return next(call)
})
```

A more extensive middleware example can be found in this [code sandbox](https://codesandbox.io/s/vjoql07ool).
For more details on creating middleware and the exact specification of middleware events, see the [docs](middleware).

Finally, it is not only possible to be notified about snapshots, patches or actions. It is also possible to re-apply them by using `applySnapshot`, `applyPatch` or `applyAction`!
