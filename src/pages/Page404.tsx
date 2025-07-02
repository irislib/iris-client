import {useNavigate} from "react-router"

export const Page404 = () => {
  const navigate = useNavigate()

  const handleHomeClick = () => {
    navigate("/")
  }

  return (
    <section className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
      <div className="text-center">
        <div className="max-w-md">
          <h1 className="text-9xl font-bold text-primary mb-2">404</h1>
          <p className="text-xl mb-8">The page you are looking for could not be found.</p>
          <button onClick={handleHomeClick} className="btn btn-primary btn-lg">
            Go back to homepage
          </button>
        </div>
      </div>
    </section>
  )
}
