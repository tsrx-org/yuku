function App() { return <div>
				@try {
					<AsyncThing />
				} pending {
					<>Loading</>
				}
			</div>; }