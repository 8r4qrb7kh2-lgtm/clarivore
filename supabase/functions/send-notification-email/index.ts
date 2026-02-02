import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { getCorsHeaders } from "../_shared/cors.ts"

const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY')
const ADMIN_EMAIL = 'matt.29.ds@gmail.com' // Your email

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const type = (body?.type || 'menu_update').toString().toLowerCase()
    const restaurantName = body?.restaurantName || 'Unknown Restaurant'
    const restaurantSlug = body?.restaurantSlug || ''

    const addedItems = Array.isArray(body?.addedItems) ? body.addedItems : []
    const removedItems = Array.isArray(body?.removedItems) ? body.removedItems : []
    const keptItems = Number(body?.keptItems || 0)

    const ingredientName = body?.ingredientName || 'Unknown ingredient'
    const photoUrl = body?.photoUrl || ''
    const feedbackText = body?.feedbackText || ''

    const hasChanges = addedItems.length + removedItems.length > 0
    let subject = `🔔 Menu Update: ${restaurantName}${hasChanges ? ' - Changes Detected' : ''}`
    let htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">
    `

    if (type === 'appeal') {
      subject = `📣 Ingredient Scan Appeal: ${restaurantName}`
      htmlContent += `
        <h2 style="color: #333;">Ingredient Scan Appeal</h2>
        <p><strong>Restaurant:</strong> ${restaurantName}</p>
        <p><strong>Ingredient:</strong> ${ingredientName}</p>
        ${photoUrl ? `<p><strong>Photo:</strong> <a href="${photoUrl}">View label image</a></p>` : ''}
        <p><a href="https://clarivore.org/restaurant.html?slug=${restaurantSlug}" style="background: #4c5ad4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Menu</a></p>
      `
    } else if (type === 'feedback') {
      subject = `📝 New Feedback: ${restaurantName}`
      htmlContent += `
        <h2 style="color: #333;">Anonymous Feedback</h2>
        <p><strong>Restaurant:</strong> ${restaurantName}</p>
        <p style="white-space:pre-wrap">${feedbackText || 'No feedback text provided.'}</p>
        <p><a href="https://clarivore.org/restaurant.html?slug=${restaurantSlug}" style="background: #4c5ad4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Menu</a></p>
      `
    } else {
      htmlContent += `
        <h2 style="color: #333;">Menu Update at ${restaurantName}</h2>
        <p>Your restaurant monitoring system detected a menu change.</p>

        ${hasChanges ? '<h3 style="color: #dc5252;">Changes Detected - Review Required</h3>' : '<h3 style="color: #4caf50;">No Changes Detected</h3>'}
      `

      if (addedItems.length > 0) {
        htmlContent += `
          <h4 style="color: #4caf50;">✅ New Items (${addedItems.length}):</h4>
          <ul>
            ${addedItems.map((item: string) => `<li>${item}</li>`).join('')}
          </ul>
        `
      }

      if (removedItems.length > 0) {
        htmlContent += `
          <h4 style="color: #dc5252;">❌ Removed Items (${removedItems.length}):</h4>
          <ul>
            ${removedItems.map((item: string) => `<li>${item}</li>`).join('')}
          </ul>
        `
      }

      if (keptItems > 0) {
        htmlContent += `<p><strong>Existing items found:</strong> ${keptItems}</p>`
      }

      htmlContent += `
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
        <p><strong>Review Changes:</strong></p>
        <p><a href="https://clarivore.org/restaurant.html?slug=${restaurantSlug}" style="background: #4c5ad4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Menu</a></p>
      `
    }

    htmlContent += `
        <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
        <p style="color: #666; font-size: 12px;">
          Sent by Clarivore Menu Monitor<br>
          <a href="https://clarivore.org" style="color: #4c5ad4;">clarivore.org</a>
        </p>
      </body>
      </html>
    `

    if (!SENDGRID_API_KEY) {
      console.warn('SendGrid API key not configured; skipping email.')
      return new Response(
        JSON.stringify({
          success: false,
          skipped: true,
          error: 'SendGrid API key not configured',
          type
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          }
        }
      )
    }

    // Send email via SendGrid
    const sendgridResponse = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: ADMIN_EMAIL }],
            subject,
          },
        ],
        from: { email: 'notifications@clarivore.org', name: 'Clarivore' },
        content: [
          {
            type: 'text/html',
            value: htmlContent,
          },
        ],
      }),
    })

    if (!sendgridResponse.ok) {
      const error = await sendgridResponse.text()
      console.error('SendGrid API error:', error)
      return new Response(
        JSON.stringify({
          success: false,
          error: `Failed to send email: ${error}`,
          type
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          }
        }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        provider: 'sendgrid',
        hasChanges,
        type
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        }
      }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to send notification'
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        }
      }
    )
  }
})
