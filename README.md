# ginko
Reactive Programming with readable syntax

# Signals
In this interpretation of Reactive Programming, the building blocks are "signals". A signal can be best understood as a process that consumes some input and produces some output. For every input it can produce none, one or multiple outputs. The process is limited, meaning that it can end at some input yielding a result.

More technically a signal is a JavaScript iterator: an object with a function "next" that returns objects of the form `{ done, value }`. When a signal has finished, it returns `{ done: true, value: result }` (i.e. like a regular iterator). Though, a signal is a special kind of iterators. A call `next()` can produce a request for input or emit an output, but never both at the same time. Specifically, signals are best written via Generators, e.g.:

```javascript
const signal = function*() {
	const a = yield Request;  // Request an input and receive it as "a". "Request" is a special object.
	yield 100;                // Emit the value 100
	yield a * 2;              // Emit the double value of the input received above
	return 'All done';        // End the signal with the given value
}
```

# Combining signals
There are three different ways of combining signals (3 dimensions). The time dimension: process one signal and when it finishes, process the next. Connect the signals head to tail: the output of the first signal becomes the input of the second. And finally, in parallel: feed two inputs with inputs at the same time and produce multiple outputs. Using the latter two dimensions can be thought of as hard-wiring a processing pipeline, where inputs flow through a two-dimensional web of signals and outputs are produced. Connecting signals in the time dimension can then be understood as rewiring this pipeline on when certain conditions are met. With all those types of combinations: combining signals gives another signal. Thus, all combinations can be mixed, though certain rules must be considered.

# Time-wise combination
This is probably the simplest form of combining signals. An example:
```javascript
const firstOdd = function*() {
	let input = yield Request;
	while (input % 2 === 0) {
		input = yield Request;
	}
	return input;
}

const atLeast = function*(value) {
	while (true) {
		const input = yield Request;
		if (input >= value) {
			yield input;
		}
	}
}

// Waits for the first odd input
// Then forever re-emits inputs that are
// greater or equal this value
const combined = function*() {
	const limit = yield* firstOdd();
	yield* atLeast(limit);
}

const signal = combined();
signal.next();     // -> Request
signal.next(2);    // -> Request
signal.next(4);    // -> Request
signal.next(11);   // -> 11
signal.next(5);    // -> Request
signal.next(12);    // -> 12

```
