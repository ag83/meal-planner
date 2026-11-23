import React from 'react'
import { createHashRouter, RouterProvider } from 'react-router-dom'

import Detail from './routes/detail'
import FirstRun from './routes/first-run'
import Gallery from './routes/gallery'
import Root from './routes/root'
import SettingsScreen from './routes/settings'

const router = createHashRouter([
  { path: '/', element: <Root /> },
  { path: '/first-run', element: <FirstRun /> },
  { path: '/gallery', element: <Gallery /> },
  { path: '/recipe/:id', element: <Detail /> },
  { path: '/settings', element: <SettingsScreen /> }
])

const App = (): React.JSX.Element => {
  return <RouterProvider router={router} />
}

export default App
