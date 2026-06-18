import React from 'react'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import Root from './routes/root'
import FirstRun from './routes/first-run'
import Gallery from './routes/gallery'
import Detail from './routes/detail'

const router = createHashRouter([
  { path: '/', element: <Root /> },
  { path: '/first-run', element: <FirstRun /> },
  { path: '/gallery', element: <Gallery /> },
  { path: '/recipe/:id', element: <Detail /> }
])

export default function App(): React.JSX.Element {
  return <RouterProvider router={router} />
}
