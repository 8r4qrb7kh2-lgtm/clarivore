// Main API function for Clarivore Menu Monitor
// Handles all API requests from the dashboard

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req)
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const path = url.pathname.replace('/api/', '')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // GET /api/restaurants - Get all restaurants with their latest check status
    if (path === 'restaurants' && req.method === 'GET') {
      const { data, error } = await supabase
        .from('restaurants')
        .select('*')
        .not('menu_url', 'is', null)
        .eq('monitor_enabled', true)
        .order('name')

      if (error) throw error

      // Transform data to match dashboard expectations
      const transformedData = data.map(r => ({
        id: r.id,
        name: r.name,
        menu_page_url: r.menu_url,
        is_active: r.monitor_enabled,
        last_checked_at: r.last_checked,
        last_change_detected_at: null, // Will be populated from snapshots
        check_frequency: 'Every 24 hours',
        total_checks: r.total_checks || 0,
        emails_sent: r.emails_sent || 0
      }))

      return new Response(
        JSON.stringify({ restaurants: transformedData }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // POST /api/restaurants - Add a new restaurant to monitor
    if (path === 'restaurants' && req.method === 'POST') {
      const body = await req.json()
      const { name, slug, menu_url, monitor_enabled = true } = body

      if (!name || !slug || !menu_url) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields: name, slug, menu_url' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
      }

      const { data, error } = await supabase
        .from('restaurants')
        .insert({
          name,
          slug,
          menu_url,
          monitor_enabled,
          total_checks: 0,
          emails_sent: 0
        })
        .select()
        .single()

      if (error) {
        console.error('Error creating restaurant:', error)
        return new Response(
          JSON.stringify({ error: error.message, details: error }),
          {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
      }

      return new Response(
        JSON.stringify({ success: true, restaurant: data }),
        {
          status: 201,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // GET /api/changes - Get recent menu changes
    if (path === 'changes' && req.method === 'GET') {
      const restaurantId = url.searchParams.get('restaurantId')

      let query = supabase
        .from('menu_snapshots')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(50)

      if (restaurantId) {
        query = query.eq('restaurant_id', restaurantId)
      }

      const { data, error } = await query

      if (error) throw error

      // Transform to show changes between snapshots
      const changes = []
      for (let i = 0; i < data.length - 1; i++) {
        if (data[i].content_hash !== data[i + 1].content_hash) {
          // Detect specific word-level changes
          const oldWords = new Set(data[i + 1].menu_text.toLowerCase().split(/\s+/))
          const newWords = new Set(data[i].menu_text.toLowerCase().split(/\s+/))

          const addedWords = [...newWords].filter(word => !oldWords.has(word) && word.length > 3)
          const removedWords = [...oldWords].filter(word => !newWords.has(word) && word.length > 3)

          let changeDescription = 'Menu modified'
          if (addedWords.length > 0 || removedWords.length > 0) {
            const parts = []
            if (addedWords.length > 0) parts.push(`Added: ${addedWords.slice(0, 5).join(', ')}`)
            if (removedWords.length > 0) parts.push(`Removed: ${removedWords.slice(0, 5).join(', ')}`)
            changeDescription = parts.join(' | ')
          }

          changes.push({
            id: data[i].id,
            dish_name: changeDescription,
            change_type: 'modified',
            old_value: removedWords.slice(0, 10).join(', ') || 'N/A',
            new_value: addedWords.slice(0, 10).join(', ') || 'N/A',
            detected_at: data[i].detected_at,
            email_sent: false,
            email_sent_at: null,
            ai_suggested_allergens: null
          })
        }
      }

      return new Response(
        JSON.stringify({ changes }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // GET /api/monitoring/snapshots/:restaurantId - Get snapshots for a restaurant
    if (path.startsWith('monitoring/snapshots/') && req.method === 'GET') {
      const restaurantId = path.split('/').pop()

      const { data, error } = await supabase
        .from('menu_snapshots')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('detected_at', { ascending: false })
        .limit(20)

      if (error) throw error

      const snapshots = data.map(s => ({
        id: s.id,
        captured_at: s.detected_at,
        menu_items: []
      }))

      return new Response(
        JSON.stringify({ snapshots }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // POST /api/monitoring/check/:restaurantId - Manually trigger a check for a restaurant
    if (path.startsWith('monitoring/check/') && req.method === 'POST') {
      const restaurantId = path.split('/').pop()

      // Call the monitor-menus function with the specific restaurant ID
      const monitorUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/monitor-menus?restaurantId=${restaurantId}`
      const response = await fetch(monitorUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`
        }
      })

      const result = await response.json()

      return new Response(
        JSON.stringify({
          success: true,
          hasChanges: false,
          ...result
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // GET /health - Health check endpoint
    if (path === 'health' && req.method === 'GET') {
      return new Response(
        JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 404 - Route not found
    return new Response(
      JSON.stringify({ error: 'Not found' }),
      {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('API Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
