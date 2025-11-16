import { MadeWithDyad } from "@/components/made-with-dyad";
import { useSession } from "@/providers/SessionContextProvider";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom"; // Import useNavigate

const Index = () => {
  const { session, isLoading, supabase } = useSession();
  const navigate = useNavigate(); // Initialize useNavigate

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleGoToChat = () => {
    navigate("/chat"); // Navigate to the new chat page
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <p className="text-xl text-gray-600 dark:text-gray-400">Loading session...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <p className="text-xl text-red-500">Not authenticated. Redirecting to login...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-900 p-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4 text-gray-900 dark:text-white">
          Welcome, {session.user?.email}!
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-400 mb-8">
          You are now authenticated. Start building your amazing project here!
        </p>
        <div className="flex space-x-4 mb-8"> {/* Added a div for buttons */}
          <Button onClick={handleGoToChat} variant="default">
            Go to Chat Interface
          </Button>
          <Button onClick={handleLogout} variant="destructive">
            Logout
          </Button>
        </div>
      </div>
      <MadeWithDyad />
    </div>
  );
};

export default Index;