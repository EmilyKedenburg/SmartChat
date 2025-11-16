"use client";

import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { supabase } from "@/integrations/supabase/client";
import { MadeWithDyad } from "@/components/made-with-dyad";

const Login = () => {
  const primaryAccentColor = "#9CC97F";
  const secondaryAccentColor = "#537E72";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-900 p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md">
        <h1 className="text-3xl font-bold text-center mb-6" style={{ color: secondaryAccentColor }}>
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
                  brand: primaryAccentColor, // Apply primary accent color to primary brand elements (button background)
                  brandAccent: primaryAccentColor, // Apply primary accent color to secondary brand elements (like hover states)
                  defaultButtonText: secondaryAccentColor, // Apply secondary accent color to button text
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