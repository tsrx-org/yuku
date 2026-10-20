function App({ cond }) {
				return <div>
					{cond
						? (<Outer>
								<Inner>hi</Inner>
							</Outer>)
						: null}
				</div>;
			}