import { parseString } from 'xml2js'
import Promise from 'bluebird'

// Excessive fields from "PhoneNumberMetadata.xml"
// aren't included to reduce code complexity and size:
//
// * `<references>` — a link to ITU (International Telecommunication Union)
//                    document describing phone numbering plan for a country
//
// * `<noInternationalDialling>` — who needs to input non-internationally-dialable phones
//
// * `<areaCodeOptional>` — we aren't in the XXth century,
//                          it's a globalized world, so write your
//                          phone numbers with area codes.
//
// * `<fixedLine>`, `<mobile>`, `<pager>`,
//   `<tollFree>`, `<premiumRate>`,
//   `<sharedCost>`, `<personalNumber>`,
//   `<voip>`, `<uan>`, `<voicemail>` — who needs that in the XXIst century.
//                                      just go mobile and stop talking nonsense.
//
// * `internationalPrefix`,
//   `preferredInternationalPrefix` — who needs to parse (or format) those weird
//                                    "internationally dialed" phone numbers
//                                    like "011 ..." in the USA.
//                                    this isn't XXth century, just use mobile phones.
//
// * `preferredExtnPrefix` — screw phone number extensions
//
// * `leadingZeroPossible` — (aka "italian leading zero")
//                           who needs to parse a phone number into an integer.
//                           just keep it as a string.
//
// * `carrierCodeFormattingRule` — only used in Brazil and Colombia
//                                 when dialing from within those countries
//                                 from mobile phones to fixed line phone numbers.
//                                 i guess brazilians and colombians
//                                 already know when to add those carrier codes
//                                 by themselves (and when not to add them)
//
// * `mobileNumberPortableRegion` — is only used to disable phone number type detection
//
// * `<possibleLengths>` — is a redundant field to speed up testing of
//                         whether a phone number format can be used to format
//                         a particular national (significant) phone number.
//
// `libphonenumber/BuildMetadataFromXml.java` was used as a reference.
// https://github.com/googlei18n/libphonenumber/blob/master/tools/java/common/src/com/google/i18n/phonenumbers/BuildMetadataFromXml.java
//
// There are three Xml metadata files in Google's `libphonenumber`:
//
//  * PhoneNumberMetadata.xml — core data, used both for parse/format and "as you type"
//
//  * PhoneNumberAlternateFormats.xml — alternative phone number formats.
//                                      is presumably used for parsing phone numbers
//                                      written in "alternative" formats.
//                                      is not used by "as you type"
//                                      presumably because of formats ambiguity
//                                      when combined with the core data.
//                                      this metadata is not used in this library
//                                      as there's no clear description on what to do with it
//                                      and how it works in the original `libphonenumber` code.
//
//  * ShortNumberMetadata.xml — emergency numbers, etc. not used in this library.
//
export default function(input)
{
	return Promise.promisify(parseString)(input).then((xml) =>
	{
		// https://github.com/googlei18n/libphonenumber/blob/master/resources/PhoneNumberMetadata.xml
		// https://github.com/googlei18n/libphonenumber/blob/master/resources/phonemetadata.proto
		// https://github.com/googlei18n/libphonenumber/blob/master/javascript/i18n/phonenumbers/phonenumberutil.js
		// https://github.com/googlei18n/libphonenumber/blob/master/javascript/i18n/phonenumbers/asyoutypeformatter.js

		const country_phone_code_to_countries = {}
		const countries = {}

		for (let territory of xml.phoneNumberMetadata.territories[0].territory)
		{
			// A two-letter country code
			const country_code = territory.$.id

			// Country metadata
			const country =
			{
				// Phone code related fields:

				// Phone code for phone numbers in this country.
				//
				// E.g. `1` for both USA and Canada.
				//
				phone_code: territory.$.countryCode,

				// In case of several countries
				// having the same country phone code,
				// these leading digits are the means
				// of classifying an international phone number
				// whether it belongs to a certain country.
				//
				// E.g. for Antigua and Barbuda
				// country phone code is `1` (same as USA)
				// and leading digits are `268`.
				//
				leading_digits: territory.$.leadingDigits,

				// The regular expression of all possible
				// national (significant) numbers for this country.
				national_number_pattern: territory.generalDesc[0].nationalNumberPattern[0].replace(/\s/g, ''),

				// National prefix related fields:

				// aka "trunk code".
				// This is the prefix prepended to a
				// national (significant) phone number
				// when dialed from within the country.
				// E.g. `0` for UK.
				national_prefix: territory.$.nationalPrefix,

				// In some (many) countries the national prefix
				// is not just a constant digit (like `0` in UK)
				// but also contains "carrier selection code"
				// (the phone company providing telephony service).
				//
				// E.g. to dial the number `2222-2222` in Fortaleza, Brazil
				// (area code 85) from within Brazil, using the long distance
				// carrier Oi (selection code 31), one would dial `0 31 85 2222 2222`.
				// Assuming the only other possible carrier selection code
				// is 32, the `national_prefix_for_parsing` field would be
				// a regular expression: `03[12]`.
				//
				// So `national_prefix_for_parsing` is used when parsing
				// a national-prefixed (local) phone number
				// into a national significant phone number.
				// (e.g. for validating it and storing in in a database)
				//
				national_prefix_for_parsing : territory.$.nationalPrefixForParsing ? territory.$.nationalPrefixForParsing.replace(/\s/g, '') : undefined,

				// If `national_prefix_for_parsing` regular expression
				// contains "captured groups", then `national_prefix_transform_rule`
				// defines how the national-prefixed (local) phone number is
				// parsed into a national significant phone number.
				// (e.g. for validating it and storing in in a database)
				//
				// Currently this feature is only used in Argentina and Brazil
				// due to their messy telephone numbering plans.
				//
				// For example, mobile numbers in Argentina are written in two completely
				// different ways when dialed in-country and out-of-country
				// (e.g. 0343 15 555 1212 is exactly the same number as +54 9 343 555 1212).
				// Therefore for Argentina `national_prefix_transform_rule` is `9$1`.
				//
				national_prefix_transform_rule: territory.$.nationalPrefixTransformRule,

				// Controls how national prefix is written
				// in a formatted local phone number.
				//
				// E.g. in Armenia national prefix is `0`
				// and `national_prefix_formatting_rule` is `($NP$FG)`
				// which means that a national significant phone number `xxxxxxxx`
				// matching phone number pattern `(\d{2})(\d{6})` with format `$1 $2`
				// is written as a local phone number `(0xx) xxxxxx`.
				//
				national_prefix_formatting_rule: national_prefix_formatting_rule(territory.$.nationalPrefixFormattingRule, territory.$.nationalPrefix),

				// Is it possible that a national (significant)
				// phone number has leading zeroes?
				//
				// E.g. in Gabon some numbers start with a `0`
				// while the national prefix is also `0`
				// which is optional for mobile numbers.
				//
				national_prefix_is_optional_when_formatting: territory.$.nationalPrefixOptionalWhenFormatting ? Boolean(territory.$.nationalPrefixOptionalWhenFormatting) : undefined,

				// I suppose carrier codes can be omitted.
				// They are required only for Brazil and Columbia,
				// and only when calling to fixed line numbers
				// from mobile phones within those countries.
				// I guess people living in those countries
				// would know that they need to add carrier codes.
				// Other people don't need to know that.
				// Anyway, if someone sends a Pull Request
				// implementing carrier codes as Google's `libphonenumber` does
				// then such Pull Request will likely be merged.
				//
				// // In some countries carrier code is required
				// // to dial certain phone numbers.
				// //
				// // E.g. in Colombia calling to fixed line numbers
				// // from mobile phones requires a carrier code when called within Colombia.
				// // Or, for example, Brazilian fixed line and mobile numbers
				// // need to be dialed with a carrier code when called within Brazil.
				// // Without that, most of the carriers won't connect the call.
				// // These are the only two cases when "carrier codes" are required.
				// //
				// carrier_code_formatting_rule: territory.$.carrierCodeFormattingRule
			}

			// Check that national (significant) phone number pattern
			// is set for this country (no "default" value here)
			if (!country.national_number_pattern)
			{
				throw new Error(`"generalDesc.nationalNumberPattern" is missing for country ${country_code} metadata`)
			}

			// Some countries don't have `availableFormats` specified,
			// because those formats are inherited from the "main country for region".
			if (territory.availableFormats)
			{
				country.formats = territory.availableFormats[0].numberFormat.map((number_format) =>
				({
					pattern: number_format.$.pattern,
					leading_digits: number_format.leadingDigits ? number_format.leadingDigits.map(leading_digits => leading_digits.replace(/\s/g, '')) : undefined,
					national_prefix_formatting_rule: national_prefix_formatting_rule(number_format.$.nationalPrefixFormattingRule, territory.$.nationalPrefix),
					national_prefix_optional_when_formatting: number_format.$.nationalPrefixOptionalWhenFormatting,
					format: number_format.format[0],
					international_format: (number_format.intlFormat && number_format.intlFormat[0] !== 'NA') ? number_format.intlFormat : undefined
				}))

				// Sanity check (using no "default" for this field)
				for (let format of country.formats)
				{
					if (!format.format)
					{
						throw new Error(`No phone number format "format" supplied for pattern ${format.pattern} for ${country_code}`)
					}
				}
			}

			// Add this country's metadata
			// to the metadata map.
			countries[country_code] = country

			// Register this country's "country phone code"

			if (!country_phone_code_to_countries[country.phone_code])
			{
				country_phone_code_to_countries[country.phone_code] = []
			}

			// In case of several countries
			// having the same country phone code.
			//
			// E.g. for USA and Canada, USA is the
			// "main country for phone code 1".
			//
			// (maybe this field is not used at all
			//  in which case this field is to be removed)
			//
			if (territory.$.mainCountryForCode === "true")
			{
				country_phone_code_to_countries[country.phone_code].unshift(country_code)
			}
			else
			{
				country_phone_code_to_countries[country.phone_code].push(country_code)
			}
		}

		// Some countries don't have `availableFormats` specified,
		// because those formats are meant to be copied
		// from the "main country for region".
		for (let country_code of Object.keys(countries))
		{
			const country = countries[country_code]

			const main_country_for_region_code = country_phone_code_to_countries[country.phone_code][0]
			const main_country_for_region = countries[main_country_for_region_code]
			country.formats = main_country_for_region.formats

			// Some countries like Saint Helena and Falkland Islands
			// ('AC', 'FK', 'KI', 'NU', 'SH', 'TA', ...)
			// don't have any phone number formats
			// and phone numbers are formatted as a block in those countries.
			if (!country.formats)
			{
				country.formats = []
			}
		}

		return { countries, country_phone_code_to_countries }
	})
}

// Replaces $NP with national prefix and $FG with the first group ($1)
function national_prefix_formatting_rule(rule, national_prefix)
{
	if (!rule)
	{
		return
	}

	// Replace $NP with national prefix and $FG with the first group ($1)
	return rule
		.replace('$NP', national_prefix)
		.replace('$FG', '$1')
}