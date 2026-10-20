function App() { return <div>
				@if (ready) {
					<>Ready</>
				} else {
					<>Waiting</>
				}
			</div>; }