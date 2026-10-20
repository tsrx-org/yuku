function App() {
					return <main>
						@{
							const a = 5;
							<span>{a}</span>

							@{
								const b = 6;
								<span>{b}</span>
							}
						}
					</main>;
				}