function App() @{
	<>
		// @tsrx-expect-error
		<style apply={missing} />
		<style apply={other} />
		<div />
	</>
}