function App() { return <div>
				@if (status === 'loading') {
					<>Loading</>
			} @else if (status === 'success') {
				<>Success</>
			} @else {
				<>Failed</>
			}
		</div>; }