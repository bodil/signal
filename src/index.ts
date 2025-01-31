import { Signal } from "signal-polyfill";
import { toDisposable, type Disposifiable } from "@bodil/disposable";
import { Err, Ok, type Result, Async } from "@bodil/core";

interface ReadableSignal<A> {
    readonly value: A;
    map<B>(fn: (value: A) => B): ComputedSignal<B>;
    on(callback: (value: A) => void): Disposable;
}

export class StateSignal<A> extends Signal.State<A> implements ReadableSignal<A> {
    get value(): A {
        return this.get();
    }

    set value(value: A) {
        this.set(value);
    }

    update(fn: (value: A) => A): void {
        this.set(Signal.subtle.untrack(() => fn(this.get())));
    }

    readOnly(): ComputedSignal<A> {
        return computed(() => this.get());
    }

    map<B>(fn: (value: A) => B): ComputedSignal<B> {
        return computed(() => fn(this.get()));
    }

    on(callback: (value: A) => void): Disposable {
        return subscribe(this, callback);
    }
}

export class ComputedSignal<A> extends Signal.Computed<A> implements ReadableSignal<A> {
    get value(): A {
        return this.get();
    }

    map<B>(fn: (value: A) => B): ComputedSignal<B> {
        return computed(() => fn(this.get()));
    }

    on(callback: (value: A) => void): Disposable {
        return subscribe(this, callback);
    }
}

type AnySignal<A> = StateSignal<A> | ComputedSignal<A>;

export type { AnySignal as Signal };

export const subtle = Signal.subtle;

export function signal<A>(value: A, options?: Signal.Options<A>): StateSignal<A> {
    return new StateSignal(value, options);
}

export function computed<A>(
    fn: (this: ComputedSignal<A>) => A,
    options?: Signal.Options<A>
): ComputedSignal<A> {
    return new ComputedSignal(fn, options);
}

let effectNeedsEnqueue = true;
const effectWatcher = new Signal.subtle.Watcher(() => {
    if (effectNeedsEnqueue) {
        effectNeedsEnqueue = false;
        queueMicrotask(effectProcess);
    }
});

function effectProcess(): void {
    effectNeedsEnqueue = true;
    for (const sig of effectWatcher.getPending()) {
        sig.get();
    }
    effectWatcher.watch();
}

export function effect(fn: () => Disposifiable | void): Disposable {
    let cleanup: Disposable | undefined;
    const computed = new ComputedSignal(() => {
        if (cleanup !== undefined) {
            cleanup[Symbol.dispose]();
        }
        const result = fn();
        cleanup = result !== undefined ? toDisposable(result) : undefined;
    });
    effectWatcher.watch(computed);
    computed.get();
    return toDisposable(() => {
        effectWatcher.unwatch(computed);
        if (cleanup !== undefined) {
            cleanup[Symbol.dispose]();
        }
    });
}

export function subscribe<A>(signal: ReadableSignal<A>, callback: (value: A) => void): Disposable {
    return effect(() => callback(signal.value));
}

export function asyncComputed<A>(
    fn: (abort: AbortSignal) => Promise<A>,
    options?: Signal.Options<A>
): Promise<ComputedSignal<A>> {
    const result = Promise.withResolvers<ComputedSignal<A>>();
    const stream = computed(() => Async.abortable(fn));
    const sig: StateSignal<Result<A, Error>> = signal(Err(new Error()));
    let job: Async.AbortableJob<A> | undefined = undefined;
    let resolved = false;
    const resolve = () => {
        if (!resolved) {
            resolved = true;
            result.resolve(computed(() => sig.get().unwrapExact(), options));
        }
    };
    effect(() => {
        if (job !== undefined) {
            job.abort();
        }
        job = stream.get();
        job.result.then(
            (next) => {
                sig.set(Ok(next));
                resolve();
            },
            (error) => {
                if (job?.signal.aborted === true) {
                    return;
                }
                sig.set(Err(error));
                resolve();
            }
        );
    });
    return result.promise;
}
