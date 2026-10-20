function App({ tag }) @{
					const label = 'outer';
					@switch (tag) {
						@case 'a': {
							const label = 'A';
							<p>{label}</p>
						}
						@case 'b': {
							const label = 'B';
							<p>{label}</p>
						}
						@default: {
							const label = 'Other';
							<p>{label}</p>
						}
					}
				}