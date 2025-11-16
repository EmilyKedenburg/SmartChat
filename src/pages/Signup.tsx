"use client";

import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";
import { supabase } from "@/integrations/supabase/client";
import { MadeWithDyad } from "@/components/made-with-dyad";
import { Link } from "react-router-dom";

const Signup = () => {
  const primaryAccentColor = "#9CC97F";
  const secondaryAccentColor = "#537E72";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-900 p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 p-8 rounded-lg shadow-md">
        <h1 className="text-3xl font-bold text-center mb-6" style={{ color: secondaryAccentColor }}>
          Create an account to get started with Smart Chat
        </h1>
        <Auth
          supabaseClient={supabase}
          providers={[]}
          appearance={{
            theme: ThemeSupa,
            variables: {
              default: {
                colors: {
                  brand: primaryAccentColor,
                  brandAccent: primaryAccentColor,
                  button: {
                    default: {
                      background: primaryAccentColor,
                      text: secondaryAccentColor,
                    },
                    hover: {
                      background: primaryAccentColor,
                      text: secondaryAccentColor,
                    },
                  },
                },
              },
            },
          }}
          theme="light"
          redirectTo={window.location.origin}
          defaultView="sign_up" // Set default view to sign up
        />
        <div className="mt-4 text-center text-sm">
          Already have an account?{" "}
          <Link to="/login" className="text-blue-600 hover:underline" style={{ color: secondaryAccentColor }}>
            Sign In
          </Link>
        </div>
      </div>
      <MadeWithDyad />
    </div>
  );
};

export default Signup;