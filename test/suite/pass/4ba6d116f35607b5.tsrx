function App() { return <>@{
				const iconNodes = [['path', { d: 'x' }], ['circle', { cx: '1' }]];
				<svg>
					@for (const [tag, attrs] of iconNodes) {
						@switch (tag) {
							@case 'path': {
								<path {...attrs} />
							}
							@case 'circle': {
								<circle {...attrs} />
							}
						}
					}
				</svg>
			}</>; }