function App() { return <div>
			@switch (value) {
				@case 'a': {
					<>Case A</>
				}
				@case 'b': {
					<>Case B</>
				}
				@default: {
					<>Fallback</>
				}
			}
		</div>; }