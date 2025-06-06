import { Signal } from "signal-polyfill";
import { toDisposable, type Disposifiable } from "@bodil/disposable";
import { Err, Ok, type Result, Async } from "@bodil/core";

interface ISignal<A> {
    readonly value: A;
    map<B>(fn: (value: A) => B): ComputedSignal<B>;
    on(callback: (value: A) => void): Disposable;
}

class StateSignal<A> extends Signal.State<A> implements ISignal<A> {
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
        return SignalGlobal.computed(() => this.get());
    }

    map<B>(fn: (value: A) => B): ComputedSignal<B> {
        return SignalGlobal.computed(() => fn(this.get()));
    }

    on(callback: (value: A) => void): Disposable {
        return SignalGlobal.subscribe(this, callback);
    }

    static is(v: unknown): v is StateSignal<unknown> {
        return v instanceof StateSignal;
    }
}

class ComputedSignal<A> extends Signal.Computed<A> implements ISignal<A> {
    get value(): A {
        return this.get();
    }

    map<B>(fn: (value: A) => B): ComputedSignal<B> {
        return SignalGlobal.computed(() => fn(this.get()));
    }

    on(callback: (value: A) => void): Disposable {
        return SignalGlobal.subscribe(this, callback);
    }

    static is(v: unknown): v is ComputedSignal<unknown> {
        return v instanceof ComputedSignal;
    }
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

type SignalGlobal<A> = StateSignal<A> | ComputedSignal<A>;

const SignalGlobal = Object.assign(
    function <A>(value: A, options?: Signal.Options<A>): SignalGlobal.State<A> {
        return new StateSignal(value, options);
    },
    {
        is(v: unknown): v is SignalGlobal<unknown> {
            return StateSignal.is(v) || ComputedSignal.is(v);
        },

        computed<A>(
            fn: (this: ComputedSignal<A>) => A,
            options?: Signal.Options<A>
        ): SignalGlobal.Computed<A> {
            return new ComputedSignal(fn, options);
        },

        subscribe<A>(signal: ISignal<A>, callback: (value: A) => void): Disposable {
            return SignalGlobal.effect(() => callback(signal.value));
        },

        effect(fn: () => Disposifiable | void): Disposable {
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
        },

        asyncComputed<A>(
            fn: (abort: AbortSignal) => Promise<A>,
            options?: Signal.Options<A>
        ): Promise<SignalGlobal.Computed<A>> {
            const result = Promise.withResolvers<ComputedSignal<A>>();
            const stream = SignalGlobal.computed(() => Async.abortable(fn));
            const sig: StateSignal<Result<A, Error>> = SignalGlobal(Err(new Error()));
            let job: Async.AbortableJob<A> | undefined = undefined;
            let resolved = false;
            const resolve = () => {
                if (!resolved) {
                    resolved = true;
                    result.resolve(SignalGlobal.computed(() => sig.get().unwrapExact(), options));
                }
            };
            SignalGlobal.effect(() => {
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
        },

        State: StateSignal,
        Computed: ComputedSignal,
        subtle: Signal.subtle,
    }
);

declare namespace SignalGlobal {
    export type State<A> = StateSignal<A>;
    export type Computed<A> = ComputedSignal<A>;
}

export { SignalGlobal as Signal };
