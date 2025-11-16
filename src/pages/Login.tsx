"use client";

import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { supabase } from "@/integrations/supabase/client";
import { MadeWithDyad } from "@/components/made-with-dyad";

const Login = () => {
  const accentColor = "#9CC97F"; // Your chosen accent color

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-900 p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md">
        <h1 className="text-3xl font-bold text-center mb-6" style={{ color: accentColor }}>
          Login to get started with Smart Chat
        </h1>
        <Auth
          supabaseClient={supabase}
          providers={[]} // You can add 'google', 'github', etc. here if desired
          appearance={{
            theme: ThemeSupa,
            variables: {
              default: {
                colors: {
                  brand: accentColor, // Apply accent color to primary brand elements
                  brandAccent: accentColor, // Apply accent color to secondary brand elements (like hover states)
                },
              },
            },
          }}
          theme="light" // Use light theme by default, can be made dynamic
          redirectTo={window.location.origin}
        />
      </div>
      <MadeWithDyad />
    </div>
  );
};

export default Login;