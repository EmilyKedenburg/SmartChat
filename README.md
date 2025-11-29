# Smart Chat Application

Welcome to the Smart Chat application! This project allows users to engage in intelligent conversations, providing context through uploaded files and website URLs. The application leverages a modern React front-end and a powerful Supabase backend for authentication, database management, file storage, and serverless functions.

## Features

*   **User Authentication:** Secure sign-up and login using Supabase Auth.
*   **Interactive Chat Interface:** Send questions and receive AI-generated responses.
*   **Contextual AI:** Provide context to the AI by uploading text files or submitting website URLs.
*   **Source Management:** View and download uploaded/processed sources for each chat.
*   **Responsive Design:** Optimized for various screen sizes using Tailwind CSS.
*   **Real-time Updates:** Messages and chat state are managed efficiently.

## Technical Details

### Front-End

*   **Framework:** React (TypeScript)
*   **Build Tool:** Vite
*   **Routing:** React Router DOM
*   **UI Library:** shadcn/ui (built with Radix UI)
*   **Styling:** Tailwind CSS
*   **State Management:** React Hooks (`useState`, `useContext`), `@tanstack/react-query`
*   **Authentication UI:** `@supabase/auth-ui-react`
*   **Toast Notifications:** `sonner`
*   **Supabase Client:** `@supabase/supabase-js`

### Back-End (Supabase BaaS)

*   **Authentication:** Supabase Auth (Email/Password)
*   **Database:** PostgreSQL
    *   Tables: `profiles`, `chats`, `messages`, `sources`, `document_chunks`
    *   Row Level Security (RLS) enabled on all custom tables.
    *   Database Function: `handle_new_user` (auto-creates profiles on signup).
    *   Vector extension for potential RAG capabilities.
*   **File Storage:** Supabase Storage (`chat-files` bucket)
*   **Serverless Functions (Edge Functions):** Deno Runtime
    *   `ask-llm`: Processes user questions, fetches/downloads source content, interacts with Google Gemini LLM, and stores responses.
*   **LLM Integration:** Google Gemini (via `@google/generative-ai` SDK)
*   **Secrets Management:** Supabase Secrets for API keys (e.g., `LLM_API_KEY`).

## How to Reproduce Project Results

Follow these steps to set up and run the Smart Chat application locally.

### Prerequisites

Before you begin, ensure you have the following installed:

*   **Node.js:** Version 18 or higher.
*   **npm:** Node Package Manager (comes with Node.js).
*   **Git:** For cloning the repository.
*   **Supabase Account:** You'll need an account to create a new project.

### Step 1: Clone the Repository

First, clone the project repository to your local machine:

```bash
git clone <repository-url>
cd <project-directory>
```

### Step 2: Install Dependencies

Install the necessary Node.js packages for the front-end:

```bash
npm install
```

### Step 3: Set up Supabase Project

1.  **Create a New Supabase Project:**
    *   Go to the [Supabase Dashboard](https://app.supabase.com/).
    *   Click "New project" and follow the prompts to create a new project.
    *   Note down your **Project ID** (e.g., `blrqybhzpcasfcgbhkqe`). You can find this in Project Settings > General.

2.  **Configure Environment Variables:**
    *   Create a file named `.env.local` in the root of your project.
    *   Add the following environment variables. Replace `YOUR_SUPABASE_URL` and `YOUR_SUPABASE_ANON_KEY` with the values from your Supabase project settings (Settings > API).
    *   You will also need a Google Gemini API key. Obtain one from the [Google AI Studio](https://aistudio.google.com/app/apikey).
    *   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are for the client-side.
    *   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` are automatically handled by Dyad for the Edge Function.
    *   `LLM_API_KEY` needs to be set as a Supabase Secret for the Edge Function.

    ```
    VITE_SUPABASE_URL="https://YOUR_SUPABASE_URL.supabase.co"
    VITE_SUPABASE_ANON_KEY="YOUR_SUPABASE_ANON_KEY"
    ```

3.  **Set Supabase Secrets for Edge Functions:**
    *   In your Supabase Dashboard, navigate to **Edge Functions** > **Manage Secrets**.
    *   Add a new secret named `LLM_API_KEY` and paste your Google Gemini API key as its value.

### Step 4: Set up Supabase Database Schema

Execute the following SQL commands in your Supabase SQL Editor (SQL Editor > New query) to set up your database tables, Row Level Security (RLS), and a trigger function.

<dyad-execute-sql description="Enable pg_vector extension">
-- Enable the pg_vector extension for vector embeddings
CREATE EXTENSION IF NOT EXISTS vector;
</dyad-execute-sql>

<dyad-execute-sql description="Create profiles table with RLS">
-- Create profiles table
CREATE TABLE public.profiles (
  id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  avatar_url TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  PRIMARY KEY (id)
);

-- Enable RLS (REQUIRED for security)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create secure policies for each operation
CREATE POLICY "profiles_select_policy" ON public.profiles
FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "profiles_insert_policy" ON public.profiles
FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_update_policy" ON public.profiles
FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY "profiles_delete_policy" ON public.profiles
FOR DELETE TO authenticated USING (auth.uid() = id);
</dyad-execute-sql>

<dyad-execute-sql description="Create function to insert profile when user signs up">
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE PLPGSQL
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, first_name, last_name)
  VALUES (
    new.id,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name'
  );
  RETURN new;
END;
$$;

-- Trigger the function on user creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
</dyad-execute-sql>

<dyad-execute-sql description="Create chats table with RLS">
-- Create chats table
CREATE TABLE public.chats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

-- Policies for chats table
CREATE POLICY "Users can only see their own chats" ON public.chats
FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert their own chats" ON public.chats
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can only update their own chats" ON public.chats
FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can only delete their own chats" ON public.chats
FOR DELETE TO authenticated USING (auth.uid() = user_id);
</dyad-execute-sql>

<dyad-execute-sql description="Create messages table with RLS">
-- Create messages table
CREATE TABLE public.messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  role TEXT NOT NULL, -- 'user' or 'assistant'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Policies for messages table
CREATE POLICY "Users can only see their own messages" ON public.messages
FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert their own messages" ON public.messages
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can only update their own messages" ON public.messages
FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can only delete their own messages" ON public.messages
FOR DELETE TO authenticated USING (auth.uid() = user_id);
</dyad-execute-sql>

<dyad-execute-sql description="Create sources table with RLS">
-- Create sources table
CREATE TABLE public.sources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id UUID REFERENCES public.chats(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- e.g., 'url', 'file'
  name TEXT NOT NULL, -- original name or URL
  content TEXT, -- extracted text content
  storage_path TEXT, -- path in Supabase Storage for files
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;

-- Policies for sources table
CREATE POLICY "Users can only see their own sources" ON public.sources
FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert their own sources" ON public.sources
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can only update their own sources" ON public.sources
FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can only delete their own sources" ON public.sources
FOR DELETE TO authenticated USING (auth.uid() = user_id);
</dyad-execute-sql>

<dyad-execute-sql description="Create document_chunks table with RLS">
-- Create document_chunks table (for RAG embeddings)
CREATE TABLE public.document_chunks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID REFERENCES public.sources(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  chunk_text TEXT NOT NULL,
  embedding vector(1536), -- Adjust dimension based on your embedding model
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

-- Policies for document_chunks table
CREATE POLICY "document_chunks_select_policy" ON public.document_chunks
FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "document_chunks_insert_policy" ON public.document_chunks
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "document_chunks_update_policy" ON public.document_chunks
FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "document_chunks_delete_policy" ON public.document_chunks
FOR DELETE TO authenticated USING (auth.uid() = user_id);
</dyad-execute-sql>

4.  **Create a Storage Bucket:**
    *   In your Supabase Dashboard, navigate to **Storage**.
    *   Click "New bucket" and create a bucket named `chat-files`.
    *   Set its policies as needed (e.g., public or private, depending on your requirements). For this app, the Edge Function will handle access, so default private is fine.

### Step 5: Deploy Edge Function

The `ask-llm` Edge Function is located in `supabase/functions/ask-llm/index.ts`. This function will be automatically deployed by Dyad when you accept the code changes.

You can verify its deployment status in your Supabase Dashboard under **Edge Functions**.

### Step 6: Run the Application

Once all the above steps are completed, you can start the development server:

```bash
npm run dev
```

The application should now be running, typically at `http://localhost:8080`.

## Usage

1.  **Sign Up/Log In:** Navigate to `/signup` or `/login` to create an account or log in.
2.  **Start Chatting:** After logging in, you will be redirected to the main chat page (`/`).
3.  **Ask Questions:** Type your question in the text area.
4.  **Provide Context:**
    *   **Upload Files:** Use the file input to upload text-based documents.
    *   **Add URLs:** Enter website URLs to fetch content from.
5.  **Submit:** Click the "Submit" button to send your question and sources to the AI.
6.  **View Sources:** Click the "View Sources" button to see a list of all sources provided for the current chat.

Enjoy your Smart Chat experience!