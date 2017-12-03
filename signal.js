const Request = { request: true };
const NoValue = { noValue: true };

const Signal = {};

Signal.until = function*(condition) {
	while (true) {
		const input = yield Request;
		if (condition(input)) { return input; }
	}
};

Signal.never = function*() {
	while (true) {
		yield Request;
	}
}

Signal.const = function*(value) {
	while (true) {
		yield Request;
		yield value;
	}
}

Signal.id = function*() {
	while (true) {
		const input = yield Request;
		yield input;
	}	
};

Signal.lift = function*(f) {
	while (true) {
		const input = yield Request;
		yield f(input);
	}
};

Signal.filter = function*(condition) {
	while (true) {
		const input = yield* Signal.until(condition);
		yield input;
	}
};

Signal.accumulate = function*(initial, accumulator) {
	let value = initial;
	while (true) {
		const input = yield Request;
		value = accumulator(value, input);
		yield value;
	}
};

Signal.map = function(signal, f) {
	return {
		sources: [signal],
		next(input) {
			const result = signal.next(input);
			if (result.value !== Request) {
				result.value = f(result.value);
			}
			return result;
		}
	};
}

function haveCommonElements(set1, set2) {
	let smaller, bigger;
	if (set1.size < set2.size) {
		smaller = set1;
		bigger = set2;
	} else {
		smaller = set2;
		bigger = set1;
	}

	for (let element of smaller) {
		if (bigger.has(element)) { return true; }
	}
	return false;
}

function gatherSources(signal) {
	const result = [signal];
	for (let i = 0; i < result.length; i++) {
		const current = result[i];
		if (current.sources) {
			result.push(...current.sources);
		}
	}
	return result;
}

function haveSameSource(s1, s2) {
	const s1Sources = new Set(gatherSources(s1));
	const s2Sources = new Set(gatherSources(s2));
	return haveCommonElements(s1Sources, s2Sources);
}

function checkSignals(signals) {
	if (signals.some(signal => !signal.next)) {
		const nonSignal = signals.find(signal => !signal.next);
		console.error('Connect should receive only signals, but got:', nonSignal);
		throw new Error('Connect should receive only signals');
	}
}

Signal.connect = function(...signals) {
	if (Array.isArray(signals[0])) {
		signals = signals[0];
	}

	checkSignals(signals);

	if (signals.length === 0) { return Signal.id(); }
	if (signals.length === 1) { return signals[0]; }
	return signals.reduce(connect2);

	function connect2(s1, s2) {
		if (haveSameSource(s1, s2)) {
			throw new Error('Signals that share sources may not be connected');
		}

		let s2Requested = false;

		return {
			sources: [s1],
			next(input) {
				let result = s2Requested ? s1.next(input) : {};

				while (!result.done && (result.value !== Request)) {
					const emit = s2.next(result.value);
					s2Requested = (emit.value === Request);
					if (emit.done || !s2Requested) { return emit; }

					result = s1.next(input);
				}

				return result;
			}
		};
	}
};

Signal.over = function(...signals) {
	if (Array.isArray(signals[0])) {
		signals = signals[0];
	}

	checkSignals(signals);

	for (let i = 0; i < signals.length; i++) {
		for (let j = i + 1; j < signals.length; j++) {
			if (haveSameSource(signals[i], signals[j])) {
				console.error('Signals that share sources may not be combined via "over":', signals[i], signals[j]);
				throw new Error('Signals that share sources may not be combined via "over"');
			}
		}
	}

	if (signals.length === 0) { return Signal.never(); }
	if (signals.length === 1) { return signals[0]; }

	const requested = signals.map(signal => false);
	const total = signals.map(signal => NoValue);

	function next(input, index) {
		const emit = signals[index].next(input[index]);
		if (emit.done) { return emit; }	

		const hasRequested = (emit.value === Request);
		requested[index] = hasRequested;

		if (!hasRequested) {
			total[index] = emit.value;
		}
	}

	return {
		sources: signals,
		next(input) {
			if (requested.every(requested => requested)) {
				for (let i = 0; i < signals.length; i++) {
					const done = next(input, i);
					if (done) { return done; }
				}
			} else {
				for (let i = 0; i < signals.length; i++) {
					if (!requested[i]) {
						const done = next([], i);
						if (done) { return done; }
					}
				}
			}

			if (requested.every(requested => requested)) {
				return { done: false, value: Request };
			}

			return { done: false, value: total.slice() };
		}
	};
};

Signal.Flow = function(context) {
	function nextLevel(currentLevel) {
		const result = new Set();

		currentLevel.forEach(signal => {
			signal.destinations.forEach((destination, index) => {
				if (result.has(destination)) { return; }

				let isNextLevel = true;
				for (let source of destination.sources) {
					if (!currentLevel.has(source)) {
						isNextLevel = false;
						break;
					}
				}

				if (isNextLevel) {
					result.add(destination);
					return;
				}

				const forwarder = apply(Signal.id(), [signal]);
				forwarder.destinations = [destination];
				forwarder.forwarder = true;

				signal.destinations[index] = forwarder;

				const sourceIndex = destination.sources.indexOf(signal);
				destination.sources[sourceIndex] = forwarder;

				result.add(forwarder);
			});
		});

		return result;
	}

	function makeLevels(inputs) {
		const result = [inputs];

		let next = nextLevel(inputs);
		while (next.size > 0) {
			result.push(next);
			next = nextLevel(next);
		}

		return result;
	}

	function fillDestinations(output) {
		const fifo = [output];

		for (let i = 0; i < fifo.length; i++) {
			const signal = fifo[i];
			signal.sources.forEach(source => { source.destinations.push(signal); });
			fifo.push(...signal.sources);
		}
	}

	function addIndices(levels) {
		levels.forEach(level => {
			let i = 0;
			for (let signal of level) {
				signal.index = i++;
			}
		});
	}

	function extractInputDescriptions(level) {
		const result = [];

		level.forEach(signal => {
			result.push({
				sourceIndexes: signal.sources.map(source => source.index),
				merge: signal.merge
			});
		});

		return result;
	}

	function consecutive(sourceIndexes) {
		return sourceIndexes.every((sourceIndex, index) => sourceIndex === index);
	}

	function makeInputFunction(sourceCount, inputDescriptions) {
		const inputFunctions = inputDescriptions.map(({ sourceIndexes, merge }) => {
			merge = merge || ((...inputs) => inputs.length === 1 ? inputs[0] : inputs);

			return inputs => merge(...sourceIndexes.map(index => inputs[index]));
		});

		return inputs => {
			if (sourceCount === 1) { inputs = [inputs]; }
			const result = inputFunctions.map(f => f(inputs));
			if (inputDescriptions.length === 1) {
				return result[0];
			}
			return result;
		};
	}

	function apply(signal, sources, merge) {
		if (!Array.isArray(sources)) {
			sources = [sources];
		}
		return { signal, merge, sources, destinations: [] };
	}

	let maxInputIndex = 0;

	const inputs = new Set();
	function makeInput(index) {
		const result = { input: index, sources: [], destinations: [] };
		inputs.add(result);
		return result;
	}

	const inputProxy = new Proxy({}, {
		get(target, property) {
			if (property === Symbol.iterator) {
				return function*() {
					for (let i = 0; true; i++) {
						maxInputIndex = i;
						yield makeInput(i);
					}
				};
			}

			if (property !== +property) { throw new Error('Inputs must be an array'); }

			if (property > maxInputIndex) {
				maxInputIndex = property;
			}

			return makeInput(property);
		}
	});

	// count inputs
	let output = context(apply, inputProxy);
	if (Array.isArray(output)) {
		if (output.length === 1) {
			output = output[0];
		} else {
			output = apply(Signal.id(), output);
		}
	}

	fillDestinations(output);

	const usedInputs = new Set();
	inputs.forEach(input => {
		if (input.destinations.length > 0) {
			usedInputs.add(input);
		}
	});

	const levels = makeLevels(usedInputs);
	addIndices(levels);

	console.log(levels);

	if (levels.length === 1) {
		return Signal.id();
	}

	const inputDescriptions = extractInputDescriptions(levels[1]);
	const inputFunction = makeInputFunction(levels[0].size, inputDescriptions);
	const signals = Array.from(levels[1]).map(entry => entry.signal);
	const over = Signal.over(signals);
	let total = Signal.connect(Signal.lift(inputFunction), over);
	let lastLevel = levels[1];

	for (let i = 2; i < levels.length; i++) {
		const currentLevel = levels[i];

		const inputDescriptions = extractInputDescriptions(currentLevel);
		const inputFunction = makeInputFunction(lastLevel.size, inputDescriptions);
		const mapped = Signal.map(total, inputFunction);
		const signals = Array.from(currentLevel).map(entry => entry.signal);
		const group = Signal.over(signals);
		
		total = Signal.connect(mapped, group);
		lastLevel = currentLevel;
	}

	return total;
};

Signal.test = function(signal, inputs) {
	const outputs = [];

	let result = signal.next();
	for (let i = 0; true; i++) {
		if (result.done) {
			return { result: result.value, rest: inputs.slice(i), outputs };
		}

		if (result.value !== Request) {
			outputs.push(result.value);
			i--;
		}

		if (i >= inputs.length) {
			return { rest: [], outputs };
		}

		const input = result.value === Request ? inputs[i] : undefined;
		result = signal.next(input);
	}
};

module.exports = { Signal, Request, NoValue };