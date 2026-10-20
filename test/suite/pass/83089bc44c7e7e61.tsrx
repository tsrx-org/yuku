function App() { return <div>
			@try {
				calls++;
			} @pending {
				<>Loading</>
			}
		</div>; }