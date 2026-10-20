async function load(items, stream) {
						for (using item of items) {}
						for await (await using item of stream) {}
					}