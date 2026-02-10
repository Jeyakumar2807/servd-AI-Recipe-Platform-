import { auth, currentUser } from "@clerk/nextjs/server";

const STRAPI_URL =
  process.env.NEXT_PUBLIC_STRAPI_URL || "http://localhost:1337";
const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN;

export const checkUser = async () => {
  const user = await currentUser();

  if (!user) {
    console.log("No User found");
    return null;
  }

  if (!STRAPI_API_TOKEN) {
    console.error("❌ STRAPI_API_TOKEN is missing in .env.local");
    return null;
  }

  // Check if user has Pro plan
  const { has } = await auth();
  const subscriptionTier = has({ plan: "pro" }) ? "pro" : "free";

  try {
    // Check if user exists in Strapi by clerkId
    const existingUserResponse = await fetch(
      `${STRAPI_URL}/api/users?filters[clerkId][$eq]=${user.id}`,
      {
        headers: {
          Authorization: `Bearer ${STRAPI_API_TOKEN}`,
        },
        cache: "no-store",
      }
    );

    if (!existingUserResponse.ok) {
      const errorText = await existingUserResponse.text();
      console.error("Strapi error response:", errorText);
      return null;
    }

    const existingUserData = await existingUserResponse.json();

    if (existingUserData.length > 0) {
      const existingUser = existingUserData[0];

      // Update subscription tier if changed
      if (existingUser.subscriptionTier !== subscriptionTier) {
        await fetch(`${STRAPI_URL}/api/users/${existingUser.id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${STRAPI_API_TOKEN}`,
          },
          body: JSON.stringify({ subscriptionTier }),
        });
      }

      return { ...existingUser, subscriptionTier };
    }

    // Check if user exists by email (in case they were created without clerkId)
    const emailUserResponse = await fetch(
      `${STRAPI_URL}/api/users?filters[email][$eq]=${encodeURIComponent(
        user.emailAddresses[0].emailAddress
      )}`,
      {
        headers: {
          Authorization: `Bearer ${STRAPI_API_TOKEN}`,
        },
        cache: "no-store",
      }
    );

    if (emailUserResponse.ok) {
      const emailUserData = await emailUserResponse.json();
      if (emailUserData.length > 0) {
        const existingUser = emailUserData[0];
        
        // Update the user with clerkId and subscription tier
        const updateData = { 
          clerkId: user.id,
          subscriptionTier 
        };
        
        const updateResponse = await fetch(
          `${STRAPI_URL}/api/users/${existingUser.id}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${STRAPI_API_TOKEN}`,
            },
            body: JSON.stringify(updateData),
          }
        );

        if (updateResponse.ok) {
          const updatedUser = await updateResponse.json();
          return updatedUser;
        }
      }
    }

    // Get authenticated role
    const rolesResponse = await fetch(
      `${STRAPI_URL}/api/users-permissions/roles`,
      {
        headers: {
          Authorization: `Bearer ${STRAPI_API_TOKEN}`,
        },
      }
    );

    const rolesData = await rolesResponse.json();
    const authenticatedRole = rolesData.roles.find(
      (role) => role.type === "authenticated"
    );

    if (!authenticatedRole) {
      console.error("❌ Authenticated role not found");
      return null;
    }

    // Create new user
    const userData = {
      username:
        user.username || user.emailAddresses[0].emailAddress.split("@")[0],
      email: user.emailAddresses[0].emailAddress,
      password: `clerk_managed_${user.id}_${Date.now()}`,
      confirmed: true,
      blocked: false,
      role: authenticatedRole.id,
      clerkId: user.id,
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      imageUrl: user.imageUrl || "",
      subscriptionTier,
    };

    const newUserResponse = await fetch(`${STRAPI_URL}/api/users`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${STRAPI_API_TOKEN}`,
      },
      body: JSON.stringify(userData),
    });

    if (!newUserResponse.ok) {
      const errorText = await newUserResponse.text();
      console.error("❌ Error creating user:", errorText);
      
      // If email already taken, try to link existing user
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error?.message === "Email already taken") {
          console.log("Email already exists, attempting to link existing user...");
          const emailUserResponse = await fetch(
            `${STRAPI_URL}/api/users?filters[email][$eq]=${encodeURIComponent(
              user.emailAddresses[0].emailAddress
            )}`,
            {
              headers: {
                Authorization: `Bearer ${STRAPI_API_TOKEN}`,
              },
              cache: "no-store",
            }
          );

          if (emailUserResponse.ok) {
            const emailUserData = await emailUserResponse.json();
            if (emailUserData.length > 0) {
              const existingUser = emailUserData[0];
              
              // Update with clerkId and subscription tier
              const updateResponse = await fetch(
                `${STRAPI_URL}/api/users/${existingUser.id}`,
                {
                  method: "PUT",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${STRAPI_API_TOKEN}`,
                  },
                  body: JSON.stringify({ 
                    clerkId: user.id,
                    subscriptionTier 
                  }),
                }
              );

              if (updateResponse.ok) {
                const updatedUser = await updateResponse.json();
                console.log("✅ Successfully linked existing user with Clerk ID");
                return updatedUser;
              }
            }
          }
        }
      } catch (parseError) {
        // If not JSON, just log the error
      }
      
      return null;
    }

    const newUser = await newUserResponse.json();
    return newUser;
  } catch (error) {
    console.error("❌ Error in checkUser:", error.message);
    return null;
  }
};
